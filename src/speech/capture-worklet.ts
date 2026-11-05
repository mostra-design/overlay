declare const currentFrame: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: unknown): void

const BATCH_SAMPLES = 4096

class Capture extends AudioWorkletProcessor {
  private batch = new Float32Array(BATCH_SAMPLES)
  private filled = 0
  private batchFrame = 0
  private batchAt = 0

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    if (this.filled === 0) {
      this.batchFrame = currentFrame
      this.batchAt = Date.now()
    }
    this.batch.set(channel, this.filled)
    this.filled += channel.length
    if (this.filled + channel.length > BATCH_SAMPLES) {
      const samples = this.batch.slice(0, this.filled)
      this.port.postMessage({ frame: this.batchFrame, at: this.batchAt, samples }, [samples.buffer])
      this.filled = 0
    }
    return true
  }
}

registerProcessor('mostra-capture', Capture)
