# Architektur der Sprachapp

Wie die App gebaut ist. Das *Was und Warum* steht im Masterplan (lokal),
der Verlauf in `docs/VERLAUF.md`.

## Grundsätze

- Reines HTML/CSS/JavaScript als ES-Module, **kein Build-Schritt, keine Frameworks**.
- **PWA auf GitHub Pages.** Alles läuft im Gerät, offline. Nutzerdaten verlassen
  das Gerät nie (Ausnahme: Google-Stimmen, wenn der Nutzer einen eigenen Schlüssel einträgt).
- Große Fremdbausteine liegen unverändert oder dokumentiert angepasst unter `vendor/`.

## Dateien

```
index.html                Hülle, vier Reiter (Üben · Übersetzen · Sätze · Optionen)
manifest.json, icons/     Startbildschirm-Symbol
sw.js                     Service Worker: Offline-Speicher, COOP/COEP
css/app.css               Gestaltung, Farbvariablen oben in :root
data/start.json           Startlektion (IDs s01…s30, Feld "version")
js/app.js                 Einstieg, Reiterwechsel; Ereignis 'navigate' {tab, mode}
js/db.js                  IndexedDB, makePhrase, Export/Import, Löschen/Wiederherstellen
js/srs.js                 Abstände, Tagesrunde (buildQueue), isReady/isDue/isNew
js/ui.js                  h(), esc(), toast() mit Aktion, Vollbild-Ansichten, Schriftgröße
js/review.js              Üben: Sprech- und Hör-Karten, freies Üben der Angepinnten
js/capture.js             Übersetzen: Richtung ⇄, Klappmenü, Anpinnen/Verschieben, Bearbeiten, Zeigen
js/library.js             Sätze: Überblick, Veredeln per Prompt, Export/Import, Liste
js/settings.js            Optionen: Anzeige, Stimmen-Manager, Google-Schlüssel
js/translate.js           Übersetzer-Schnittstelle translate(text, {from, to})
js/bergamot.js            Quelle Bergamot (offline)
js/prompt.js              Veredeln: Prompt bauen, KI-Antwort großzügig einlesen
js/decode.js              wörtliche Zeile (Birkenbihl) anzeigen
js/audio.js               Aufnahme (ohne Filter), Pegel, Wiedergabe, Lautstärke angleichen, speak()
js/voice.js               Stimmen je Sprache, Erzeugen + Speichern (Store 'tts')
js/voice-worker.js        Kokoro im Worker
js/piper-worker.js        Piper im Worker
vendor/bergamot/          Übersetzer (MPL-2.0), Modelle deen + ende, registry.json
vendor/kokoro/            kokoro-js (angepasst, siehe ANPASSUNGEN.md), ONNX-Laufzeit, 8 Stimmen
vendor/piper/             piper_phonemize (eSpeak NG), Stimmen Thorsten + Kerstin
```

## Datenmodell (IndexedDB `sprachapp`, Version 2)

Stores: `phrases` (Karten), `recordings` (letzte eigene Aufnahme je Karte),
`settings` (Schlüssel/Wert), `tts` (erzeugte Stimme, Schlüssel `provider:id|text`).

Wichtige Felder einer Karte (`makePhrase` in `db.js`):

| Feld | Bedeutung |
|---|---|
| `de`, `en` | beide Sprachseiten |
| `dir` | `de-en` = Sprech-Karte (selbst sagen), `en-de` = Hör-Karte (gehört, verstehen) |
| `decode` | `[[englisch, wörtlich-deutsch], …]` |
| `note` | Erklärung hinter „Warum?“ |
| `source` | start · bergamot · prompt · mensch · offen |
| `refined` | hat eine geprüfte Fassung mit wörtlicher Zeile |
| `human` | Übersetzung vom Nutzer korrigiert → beim Veredeln geschützt |
| `flagged` | „Komisch?“ gedrückt → geht ins Veredeln |
| `learn` | `false` = nur übersetzt, nicht üben |
| `pinned`, `pinOrder` | angepinnt, eigene Reihenfolge |
| `interval`, `streak`, `reps`, `lapses`, `due`, `firstSeen` | Wiederholungsplan |

Einstellungen (Auswahl): `level` (Tempo), `literal` (tip/always/off), `fontScale`,
`voice.en`, `voice.de` (`{provider, id}`), `google.key`, `google.voices`, `captureDir`.

## Wiederholung (`srs.js`)

- Sitzt: Abstand ×2,5 (1 → 3 → 8 → 20 → 50 Tage). Wackelig: ×1,2. Noch nicht: 1 Tag.
- Tagesrunde: erst Fälliges, dann max. 8 neue pro Tag. Runde endet nach 10 Min.
- Geübt wird nur, was `isReady` ist: beide Sprachen vorhanden und `learn !== false`.

## Service Worker (`sw.js`) – wichtig

- App-Dateien: online immer frisch (`cache: 'no-cache'`), Kopie in `CACHE`,
  offline aus dem Cache. **`CACHE` bei jeder Änderung hochzählen.**
- `vendor/` außer `.json`: cache-first in `VENDOR_CACHE` (überlebt App-Updates;
  nur bei geänderten Modelldateien Version erhöhen – dann laden Handys alles neu).
- `.json` unter `vendor/` läuft wie App-Dateien, sonst würden neue Modelle nie erkannt.
- Setzt COOP/COEP/CORP auf alle eigenen Antworten → `crossOriginIsolated` →
  mehrere Rechenkerne für Kokoro/Piper.

## Stimmen

- `audio.speak(text, {lang, rate})`: gewählte Stimme; aus Speicher, sonst erzeugen,
  wenn sofort möglich; sonst Systemstimme und Satz fürs nächste Mal vorbereiten.
- Kokoro: q8-Modell (92 MB), ~1,8 s Rechenzeit pro Sekunde Sprache (PC) → Runde wird
  zu Beginn komplett im Hintergrund vorbereitet.
- Piper: Laute über `piper_phonemize` als Zeichen, Nummern über die Lauttabelle der
  jeweiligen Stimme (ältere Modelle kennen weniger Zeichen).
- Google: Header `X-Goog-Api-Key`, Schlüssel nur in IndexedDB, MP3, Chirp 3 HD zuerst.
- Tempo über `playbackRate` (Tonhöhe bleibt), daher jeder Satz nur einmal erzeugt.

## Übersetzer

- Bergamot, Modelle laden erst bei erster Nutzung der Richtung (`deen` 23 MB, `ende` 21 MB,
  gemeinsames Vokabular). Neue Richtung/Sprache: Dateien nach `vendor/bergamot/models/<paar>/`,
  Eintrag in `registry.json` mit Prüfsummen aus der Bergamot-Registry.
- Weitere Quellen (PC/Ollama) später über `registerSource()`.

## Veredeln (`prompt.js`)

- Prompt fordert striktes JSON (`id, de, en, decode, note`). Einlesen großzügig:
  Codeblöcke, Text drumherum, Komma-Fehler, typografische Anführungszeichen (zuletzt).
- `en_fest` / `de_fest` für vom Nutzer korrigierte Fassungen, `en_gehoert` für Hör-Sätze.

## Testen

- Eingebauter Browser, Konfiguration `sprachapp` aus `.claude/launch.json`, Port 8321,
  `resize_window` mobile. Nach Änderungen: `registration.update()`, zweimal neu laden.
- Mikrofon im Test-Browser gesperrt → `getUserMedia` durch Oszillator-Stream ersetzen.
- Zwischenablage im Test-Browser gesperrt → Kopieren nur auf dem Handy prüfbar.
