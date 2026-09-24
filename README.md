# Sprachapp

Offline-Sprachlern-App als Web-App (PWA), Deutsch → Englisch.

- **Erfassen:** deutschen Satz diktieren, englische Fassung sofort – übersetzt direkt im Gerät, ohne Netz.
- **Wiederholen:** jede Wendung kommt in wachsenden Abständen zurück. Selbst sprechen, Muster hören, eigene Aufnahme direkt danach.
- **Veredeln:** die App erzeugt einen Prompt für eine KI nach Wahl; die Antwort liefert natürliche Fassungen mit wörtlicher Übersetzung (Birkenbihl).

Alle Lerndaten bleiben auf dem Gerät. Kein Konto, keine Werbung, kein Abo.

## Fremde Bestandteile

- `vendor/bergamot/` – [Bergamot Translator](https://github.com/browsermt/bergamot-translator) und Übersetzungsmodell Deutsch→Englisch, Mozilla Public License 2.0.
- `vendor/kokoro/` – [kokoro-js](https://github.com/hexgrad/kokoro) und Modell [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), Apache-2.0; ONNX-Laufzeit aus Transformers.js, MIT. Änderungen siehe `vendor/kokoro/ANPASSUNGEN.md`.
