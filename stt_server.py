# stt_server.py - servidor de transcripcion persistente (faster-whisper).
# Carga el modelo UNA vez y transcribe rutas de audio (wav) que llegan por stdin,
# una por linea. Imprime un JSON por linea: {"text":...,"lang":...} o {"error":...}.
import sys, json, os, wave
import numpy as np
from faster_whisper import WhisperModel

MODEL = os.environ.get("WHISPER_MODEL", "base")
model = WhisperModel(MODEL, device="cpu", compute_type="int8")
print(json.dumps({"ready": True, "model": MODEL}), flush=True)

def load_wav(path):
    # espera wav PCM 16-bit mono 16kHz (lo garantiza ffmpeg)
    with wave.open(path, "rb") as w:
        data = w.readframes(w.getnframes())
    return np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0

for line in sys.stdin:
    p = line.strip()
    if not p:
        continue
    try:
        audio = load_wav(p)
        segments, info = model.transcribe(audio, language=None, vad_filter=True)
        text = "".join(s.text for s in segments).strip()
        print(json.dumps({"text": text, "lang": info.language}), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
