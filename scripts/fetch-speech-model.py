# /// script
# requires-python = ">=3.12"
# dependencies = ["onnx==1.21.0"]
# ///
import hashlib
import sys
import urllib.request
from pathlib import Path

import onnx
from onnx import TensorProto, helper

WHISPER = "https://huggingface.co/onnx-community/whisper-base/resolve/1846881b6b3a3024392c1eea3ad983695bc23925"
TIMED = "https://huggingface.co/onnx-community/whisper-base_timestamped/resolve/608c49e61301901684bc36cac8f74b95ff6b5a8e"
SILERO = "https://raw.githubusercontent.com/snakers4/silero-vad/066409f3d9db45a30d21dfcbf9147826ffdd7052/src/silero_vad/data/silero_vad.onnx"
FILES = {
    "whisper-base/config.json": (f"{WHISPER}/config.json", "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b"),
    "whisper-base/generation_config.json": (f"{WHISPER}/generation_config.json", "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0"),
    "whisper-base/preprocessor_config.json": (f"{WHISPER}/preprocessor_config.json", "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"),
    "whisper-base/tokenizer.json": (f"{WHISPER}/tokenizer.json", "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"),
    "whisper-base/tokenizer_config.json": (f"{WHISPER}/tokenizer_config.json", "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573"),
    "whisper-base/onnx/encoder_model_int8.onnx": (f"{WHISPER}/onnx/encoder_model_int8.onnx", "ca6177401f86a2c6b4dc5f7fc02fbca680678906bd0c22f6d89f0b80f124253f"),
    "whisper-base/onnx/decoder_model_merged_int8.onnx": (f"{TIMED}/onnx/decoder_model_merged_int8.onnx", "cf9a8d5bcddc0917a0078135b484cedcaf44f28909cd91910abd29dced9171db"),
    "silero-vad.onnx": (SILERO, "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"),
}
ENCODER = "whisper-base/onnx/encoder_model_int8.onnx"
CHANGED_ENCODER = "48cf021ce72f719b4e42c1922aede8617fdf2c22348079f46657c6e0905326f2"
POSITIONS = "embed_positions.weight"

def checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def fetch(path: Path, url: str, expected: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, path)
    actual = checksum(path)
    if actual != expected:
        path.unlink()
        sys.exit(f"{url} has checksum {actual}, expected {expected}")

def constant(name: str, values: list[int], scalar: bool = False):
    dimensions = [] if scalar else [len(values)]
    return helper.make_node("Constant", [], [name], value=helper.make_tensor(f"{name}_value", TensorProto.INT64, dimensions, values))

def accept_any_length(path: Path) -> None:
    model = onnx.load(path)
    graph = model.graph
    index, add = next((index, node) for index, node in enumerate(graph.node) if POSITIONS in node.input)
    table_input = list(add.input).index(POSITIONS)
    hidden = add.input[1 - table_input]
    added = [
        helper.make_node("Shape", [hidden], ["hidden_shape"]),
        constant("time_axis", [1], scalar=True),
        helper.make_node("Gather", ["hidden_shape", "time_axis"], ["hidden_length"], axis=0),
        constant("first_axis", [0]),
        helper.make_node("Unsqueeze", ["hidden_length", "first_axis"], ["positions_end"]),
        constant("positions_start", [0]),
        helper.make_node("Slice", [POSITIONS, "positions_start", "positions_end", "first_axis"], ["positions"]),
    ]
    for offset, node in enumerate(added):
        graph.node.insert(index + offset, node)
    add.input[table_input] = "positions"
    onnx.checker.check_model(model)
    onnx.save(model, path)

def main() -> None:
    target = Path(__file__).resolve().parent.parent / "speech-model"
    for name, (url, expected) in FILES.items():
        fetch(target / name, url, expected)
    accept_any_length(target / ENCODER)
    actual = checksum(target / ENCODER)
    if actual != CHANGED_ENCODER:
        sys.exit(f"The changed encoder has checksum {actual}, expected {CHANGED_ENCODER}")
    print(f"Done: {target}")

if __name__ == "__main__":
    main()
