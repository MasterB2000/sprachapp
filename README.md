# Sprachapp

Offline-Sprachlern-App als Web-App (PWA), Deutsch → Englisch.

- **Übersetzen:** Deutsch ⇄ Englisch diktieren, Übersetzung sofort – direkt im Gerät, ohne Netz. Jeder Satz wird zur Übungskarte (gehörte Sätze zur Hör-Karte).
- **Üben:** jede Wendung kommt in wachsenden Abständen zurück. Selbst sprechen, Muster hören, eigene Aufnahme vergleichen.
- **Veredeln:** die App erzeugt einen Prompt für eine KI nach Wahl; die Antwort liefert natürliche Fassungen mit wörtlicher Übersetzung (Birkenbihl).

Alle Lerndaten bleiben auf dem Gerät. Kein Konto, keine Werbung, kein Abo.

## Fremde Bestandteile

- `vendor/bergamot/` – [Bergamot Translator](https://github.com/browsermt/bergamot-translator) und Übersetzungsmodelle Deutsch⇄Englisch, Mozilla Public License 2.0.
- `vendor/piper/` – Piper-Stimmen Thorsten und Kerstin ([rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices), Daten CC0) und `piper_phonemize` mit eSpeak NG ([@diffusionstudio/piper-wasm](https://www.npmjs.com/package/@diffusionstudio/piper-wasm), MIT; eSpeak NG GPL-3.0).
- `vendor/kokoro/` – [kokoro-js](https://github.com/hexgrad/kokoro) und Modell [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), Apache-2.0; ONNX-Laufzeit aus Transformers.js, MIT. Änderungen siehe `vendor/kokoro/ANPASSUNGEN.md`.
