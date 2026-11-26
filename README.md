# ZarbSaz — ضرب‌ساز

A web studio for reading, editing, composing, and playing **Persian Tonbak (تنبک)** standard notation (Bahman Rajabi / Hossein Tehrani single-line percussion style).

## Features

- **Single-Line Tonbak Sheet Music Engraving**: Crisp SVG rendering of Tom (`؟`), Bak Right (`^`), Bak Left (`v̇` with finger `2`/`3`/`=`), Pelang R/L, Chap (`^̄`), Riz (`^v` tremolo), Eshareh (`5`), beamed 8th/16th/32nd notes, slurred Pelang grace notes, and `%` measure repeats.
- **Cross-Page Copy & Paste**: Select individual notes or multi-measure sections (`Shift+Click` measure badges) on any page, copy (`⌘C`), and paste (`⌘V`) into your own compositions, or save reusable phrases to the Snippet Bank.
- **Photo Upload & Dual-Mode OCR / OMR**:
  - **AI Vision OCR**: Upload a photo (or pick from local book photos) and transcribe the full page via OpenRouter, Gemini, or OpenAI vision models.
  - **Local Offline OMR**: Built-in browser computer-vision pipeline that detects staves, barlines, noteheads, beams, and stroke symbols with zero API calls.
- **Tonbak Web Audio Synthesizer & Player**: Physically-inspired Web Audio synthesis for every tonbak stroke, with Play Page, Play Selection, Loop, Metronome Click, BPM & Volume sliders, and live visual playhead tracking.

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`.

### Optional: AI Vision OCR

Set `OPENROUTER_API_KEY` (or `GEMINI_API_KEY` / `OPENAI_API_KEY`) in your environment before running `npm run dev`, or enter an API key directly in the **Scan Photo (OCR) → API Settings** panel. Local Offline OMR works without any API key.

## Scripts

- `npm run dev` — Start local dev server
- `npm test` — Run Vitest unit tests
- `npm run build` — Type-check and build production bundle
