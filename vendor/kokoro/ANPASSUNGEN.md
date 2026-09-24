# Anpassungen an kokoro.web.js (kokoro-js 1.2.1, Apache-2.0)

1. Stimmen werden relativ zur Datei aus `./voices/` geladen statt von huggingface.co
   (offline-fähig).
2. `env` exportiert zusätzlich `transformers` (die Transformers.js-Einstellungen), damit
   das Modell aus `./models/` geladen werden kann.

Modell: onnx-community/Kokoro-82M-v1.0-ONNX, `onnx/model_quantized.onnx`
(SHA-256 fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478), Apache-2.0.
ONNX-Laufzeit: aus @huggingface/transformers 3.5.1 (`ort/`), MIT.
