import { AutoProcessor, env, WhisperForConditionalGeneration, type Tensor } from '@huggingface/transformers'
import { SPEECH_RATE } from './resampler'
import { cleanedText, untilRepeat, whisperLanguage, withoutRestart } from './transcript'

const MODEL = 'whisper-base'
const DTYPE = 'int8'
export const MODEL_BYTES = 23_201_729 + 53_712_708 + 2_480_466 + 300_000

const TAIL_SAMPLES = SPEECH_RATE
const LONGEST_WINDOW_SAMPLES = 30 * SPEECH_RATE
const TIMESTAMP_SECONDS = 0.02
const END_MARGIN_SECONDS = 0.6
const PROMPT_TOKENS = 3
const TOKENS_PER_SECOND = 12
const SPARE_TOKENS = 16

function ending(timestampBegin: number, seconds: number, endOfText: number): Processor {
  return (inputs, logits) => {
    inputs.forEach((sequence, index) => {
      const tokens = sequence.map(Number)
      const last = tokens.at(-1)!
      const reachedTheEnd = last >= timestampBegin && (last - timestampBegin) * TIMESTAMP_SECONDS >= seconds
      const startedOver = untilRepeat(tokens.slice(PROMPT_TOKENS)).length < tokens.length - PROMPT_TOKENS
      if (!reachedTheEnd && !startedOver) return
      const scores = (logits as unknown as Tensor[])[index]!.data as Float32Array
      scores.fill(-Infinity)
      scores[endOfText] = 0
    })
    return logits
  }
}

function keptLast(last: Processor): Processor[] {
  const list = [last]
  list.push = (...added: Processor[]) => {
    list.splice(list.length - 1, 0, ...added)
    return list.length
  }
  return list
}

export async function loadWhisper(base: string, onBytes: (loaded: number) => void, device: 'wasm' | 'cpu' = 'wasm') {
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.remoteHost = base
  env.remotePathTemplate = '{model}/'
  const loaded = new Map<string, number>()
  const progress_callback = (info: { status: string; file?: string; loaded?: number }) => {
    if (info.status !== 'progress' || !info.file) return
    loaded.set(info.file, info.loaded ?? 0)
    onBytes(Array.from(loaded.values()).reduce((total, bytes) => total + bytes, 0))
  }
  const processor = await AutoProcessor.from_pretrained(MODEL, { progress_callback })
  const model = await WhisperForConditionalGeneration.from_pretrained(MODEL, { dtype: DTYPE, device, progress_callback })
  const features = processor.feature_extractor!
  const tokenizer = processor.tokenizer!
  const config = model.generation_config as unknown as { no_timestamps_token_id: number; eos_token_id: number; lang_to_id: Record<string, number> }
  const timestampBegin = config.no_timestamps_token_id + 1
  const textEnd = config.eos_token_id

  return {
    language: (language: string) => whisperLanguage(language, config.lang_to_id),

    async transcribe(audio: Float32Array, language: string): Promise<Spoken> {
      const seconds = audio.length / SPEECH_RATE
      const window = Math.min(audio.length + TAIL_SAMPLES, LONGEST_WINDOW_SAMPLES)
      const { input_features } = await features(audio, { max_length: window })
      const generated = (await model.generate({
        inputs: input_features,
        language,
        task: 'transcribe',
        return_timestamps: true,
        max_new_tokens: Math.ceil(SPARE_TOKENS + seconds * TOKENS_PER_SECOND),
        logits_processor: keptLast(ending(timestampBegin, seconds - END_MARGIN_SECONDS, textEnd)) as never,
        return_token_timestamps: true,
        num_frames: Math.ceil(window / 320),
      })) as unknown as { sequences: Tensor; token_timestamps: Tensor }
      const times = Array.from(generated.token_timestamps.data as Float32Array, Number)
      const said = Array.from(generated.sequences.data as BigInt64Array, Number)
        .map((token, index) => ({ token, at: times[index] ?? 0 }))
        .slice(PROMPT_TOKENS)
        .filter(({ token }) => token < textEnd)
      const tokens = withoutRestart(untilRepeat(said.map(({ token }) => token)))
      const text = cleanedText(tokenizer.decode(tokens, { skip_special_tokens: true }))
      if (!text) return { text, words_ms: null }
      const spans = tokens.map((_token, index) => [said[index]!.at, said[index + 1]?.at ?? said[index]!.at])
      const words = (tokenizer as unknown as Collating).collateWordTimestamps(tokens, spans, 'english')
      const words_ms = words.map((word) => Math.round(word.timestamp[0] * 1000))
      return { text, words_ms: text.split(/\s+/).length === words_ms.length ? words_ms : null }
    },
  }
}

export type Whisper = Awaited<ReturnType<typeof loadWhisper>>

type Processor = (inputs: bigint[][], logits: Tensor) => Tensor

export type Spoken = { text: string; words_ms: number[] | null }

type Collating = { collateWordTimestamps(tokens: number[], spans: number[][], language: string): Array<{ text: string; timestamp: [number, number] }> }
