# hikari

`hikari` is a reader experience that experiments with assisted translation
workflows. The repository is organised as a small monorepo with the web reader
living under `apps/web`.

## Project structure

- `apps/web/components` – UI used by the reader, including translation toggles
  and settings panes.
- `apps/web/providers` – Production translation adapters. Each adapter is
  registered in the provider registry and surfaced in the UI.
- `apps/web/utils` – Client helpers for scheduling translation work and caching
  results in IndexedDB via Dexie.

## Development

> The exercise repository only contains the files relevant to the translation
> pipeline. In the real project these folders sit inside a Next.js app managed
> with `pnpm`. To experiment locally, copy the contents into the full project
> and run the usual Next.js development server (`pnpm dev`).

## Translation pipeline

The web reader ships with a production-ready translation pipeline that proxies
requests to Azure Cognitive Services (Translator). The pipeline performs the
following steps:

1. Sentences queued for translation are windowed to respect API request limits
   and the configured document budget.
2. Each batch is sent to the provider adapter, which validates credentials and
   tracks the estimated cost based on character counts.
3. Results are written back to Dexie, populating `sentences.translation_en` or
   `sentences.translation_ja` depending on the requested direction. A
   normalized cache entry is also stored in `caches` so repeated requests can be
   served instantly.
4. The UI exposes toggles for both Japanese→English and English→Japanese modes
   along with a provider selector. The reader automatically reuses cached
   translations and reports the last job cost.

## Environment variables

Create a `.env.local` that mirrors the example below:

```bash
NEXT_PUBLIC_PROVIDER=azure-translation
NEXT_PUBLIC_TRANSLATION_BUDGET_CENTS=500
AZURE_TRANSLATION_ENDPOINT=https://YOUR_RESOURCE_NAME.cognitiveservices.azure.com/
AZURE_TRANSLATION_REGION=YOUR_RESOURCE_REGION
AZURE_TRANSLATION_KEY=YOUR_SUBSCRIPTION_KEY
AZURE_TRANSLATION_PRICE_PER_CHARACTER_USD=0.00002
```

* `NEXT_PUBLIC_PROVIDER` — Which translation adapter to bootstrap in the UI.
* `NEXT_PUBLIC_TRANSLATION_BUDGET_CENTS` — Maximum cents that may be spent
  translating a single document.
* `AZURE_TRANSLATION_*` — Credentials for Azure Cognitive Services. These are
  required for production use.
* `AZURE_TRANSLATION_PRICE_PER_CHARACTER_USD` — Optional override used to
  estimate costs before requests are dispatched.

The Dexie schema is automatically created the first time the reader runs in a
browser context. When using the real Azure adapter make sure to enable the
Translator resource in the selected region and grant the API key access to the
Text Translation API.

### Word-level dictionary & morphology configuration

The reader now tokenises each sentence and opens word-level popups with
dictionary, conjugation, audio, and (when available) pitch-accent data. The
default demo uses `Intl.Segmenter` for coarse tokenisation and the mock
dictionary provider, which is enough to explore the UI but does not return full
grammar metadata. To plug in production services:

1. **Morphology API** — enable the built-in Sudachi-powered tokenizer by
   pointing the client at `/api/morphology` and providing a dictionary file.
   The worker expects `{ tokens: [{ surface, base, reading, pos, features,
   conjugation, pitch }] }` so any compatible analyzer can be swapped in later.
   Start with:

   ```bash
   NEXT_PUBLIC_MORPHOLOGY_ENDPOINT=/api/morphology
   NEXT_PUBLIC_MORPHOLOGY_API_KEY=optional-shared-secret
   SUDACHI_SPLIT_MODE=C
   # Optional override when the dictionary lives elsewhere
   # SUDACHI_DICTIONARY_PATH=/absolute/path/to/system_full.dic
   ```

   Steps:

  - Install the Sudachi WASM bindings in the web app: `pnpm --filter web add
    sudachi` (or vendor a compatible module and update
    `SUDACHI_MODULE_CANDIDATES`). If Sudachi is unavailable, the API route
    automatically falls back to the bundled Kuromoji tokenizer—install it with
    `pnpm --filter web add kuromoji @types/kuromoji@0.1.3` so the fallback can
    spin up successfully.
   - Download the latest Sudachi Full dictionary and place the extracted
     `system_full.dic` under `apps/web/lib/sudachi/` (the directory is gitignored)
     or set `SUDACHI_DICTIONARY_PATH` to its location.
   - Restart `pnpm dev` so the API route can initialise the tokenizer.
   - Re-import or trigger the retokenisation workflow for existing documents to
     refresh stored tokens with Sudachi output.

   Prefer a different analyzer (SudachiPy, Kuromoji, MeCab, etc.)? Expose it via
   an HTTP endpoint that returns the same token payload and update
   `NEXT_PUBLIC_MORPHOLOGY_ENDPOINT` accordingly.

2. **Dictionary data** — replace `providers/dictionary/mock.ts` with a real
   dictionary (JMdict, commercial API, etc.). Populate `Definition.senses`,
   `partOfSpeech`, `notes`, `pitch`, and `audio.url`/`audio.text` for richer
   popups.

3. **Pitch accent** — return `{ pattern: string; accents: number[] }` within the
   morphology or dictionary response. The popup renders the pattern string and
   accent positions when supplied.

4. **Audio** — the popup reuses the active TTS provider. If your dictionary
   returns pre-recorded audio, set `definition.audio.url` and the play button
   will stream it instead of synthesising speech.

Without custom providers the UI still tokenises via `Intl.Segmenter`, defaults
the base form to the clicked surface, and falls back to inline translation for
definitions.
# Hikari Reader

Hikari Reader is a Next.js Progressive Web App for sentence-aligned bilingual reading between Japanese and English. V1 focuses on client-first storage, mock language services, and an installable PWA scaffold so teams can plug in production-grade providers later without refactoring.

## Overview

* Import long-form Japanese or English text (PDF pipeline stubbed) into IndexedDB for offline-first reading.
* Sentence-level navigation with per-sentence playback, inline translations, and word popups powered by provider adapters.
* Mock translation, dictionary, and TTS providers showcase the adapter pattern and allow the demo to run without paid services.
* Save vocabulary to a built-in SRS deck and practice with an SM-2-inspired scheduler.
* Installable PWA skeleton with a vanilla service worker ready to swap for Workbox.

## Quick Start

```bash
pnpm install
pnpm dev # starts apps/web on http://localhost:3000
```

> Need text-to-speech? Copy `apps/web/.env.local.example` to `apps/web/.env.local`, add your Azure Speech key, then restart the dev server.

1. Visit `http://localhost:3000/dev/seed` and click **Seed Demo Data**.
2. Open `/documents` to browse imported documents.
3. Enter a document to test sentence playback, inline translations, and word popups.
4. Explore `/practice` for the SM-2 flashcard loop.

## Feature Flags & Providers

Provider adapters live under `apps/web/providers/*`.

* **Translation** — `TranslationProvider` interface with a mock implementation returning demo fixture text. Use `getTranslationProvider(id)` to fetch the active provider.
* **Dictionary** — `DictionaryProvider` interface returning mock readings + translation fallback. Replace with JMdict or a licensed API.
* **TTS** — `TtsProvider` interface with a mock beep generator and an Azure Cognitive Services integration. Switch providers with `NEXT_PUBLIC_PROVIDER`.

Set `NEXT_PUBLIC_PROVIDER=mock` (default) to use local beeps, or `NEXT_PUBLIC_PROVIDER=azure` once credentials are configured. Future integrations can branch on this environment variable.

## Environment Variables

The demo does not require keys, but placeholders are documented for future integrations:

* `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, optional `AZURE_SPEECH_ENDPOINT`
* `AZURE_TTS_BUDGET_CENTS` (default `$1.00` per day)
* `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
* `OPENAI_API_KEY`, `DEEPL_API_KEY`
* `OCR_SERVER_URL`
* `NEXT_PUBLIC_PROVIDER`
* `NEXT_PUBLIC_TTS_VOICE`

## What’s Stubbed

* PDF text extraction and OCR routes respond with metadata only.
* Mock translation/dictionary/TTS services log requests and return deterministic placeholder data.
* Service worker caches via a simple runtime cache (replace with Workbox for production policies).

## Legal Notes

* Ensure users have rights to the text or PDFs they import; the app stores copies locally.
* Dictionary and pitch-accent resources may require additional licensing before bundling.
* Audio generated by third-party TTS providers must respect their usage terms.

## Performance Tips

* Tokenization and PDF work should happen in Web Workers—current stubs highlight extension points in `apps/web/workers`.
* Use translation windowing (see `providers/translation/mock.ts`) to prefetch only the current viewport.
* IndexedDB tables are keyed for quick lookups by document and sentence ID; prune caches from `/dev/debug` when testing large files.

## Troubleshooting

* **Tokenizer fails** — ensure the mock seed succeeded; kuromoji integration will live in `workers/tokenize-ja.ts`.
* **PDF/OCR fails** — current API routes are placeholders. Implement server-side `pdf-parse` + Tesseract per the README TODO.
* **Large docs feel slow** — adjust page word budget and prefetch windows in `/settings`.

## PWA Setup

* Manifest lives in `apps/web/public/manifest.webmanifest` (Codex text-only mode uses an SVG icon placeholder).
* Service worker logic is in `apps/web/lib/sw.ts`. Replace with Workbox to add background sync, offline routing, and cache quotas.
* Settings include `offlineMode`, `maxAudioCacheMB`, and `maxTranslationCacheMB` to enforce LRU policies once implemented.

## TO-DO (Post-Key Integration Guide)

1. **TTS (Azure/AWS)** — integrate paid providers with timestamp support, store audio blobs in IndexedDB, respect quota.
2. **Translation (DeepL/OpenAI/etc.)** — enforce per-document budget caps and throttle requests.
3. **Dictionary (JMdict/licensed)** — ingest dictionary data and expose toggles in Settings.
4. **Pitch Accent** — add provider implementation returning `{ pattern, accents }` to enrich the word popup.
5. **Server OCR** — wire `/api/pdf/ocr` to a Tesseract CLI container (see docker-compose stub).

## Roadmap

* Multi-user sync and optional cloud backup.
* Enhanced mobile controls and gesture navigation.
* Expanded language support with pluggable tokenizers and RTL layout flags.
* Automated Playwright coverage for import → read → practice flow.

## Repository Structure

```
apps/
  web/
    app/                # Next.js App Router routes (documents, practice, settings, dev tools)
    components/         # Reader UI, import forms, shared components
    fixtures/           # Demo Japanese/English text pairs
    lib/                # Dexie schema, SRS helpers, service worker
    providers/          # Adapter interfaces + mock implementations
    scripts/            # Dev utilities (seed demo)
    store/              # Zustand stores for documents, settings, SRS
    workers/            # Sentence splitter placeholder (expand with tokenizers/OCR)
```

## Testing

* Unit testing via Vitest (scaffolded). Add suites for translation windowing and SRS calculations.
* Playwright planned for E2E flows: import, reader playback, word popup, SRS review.

## Docker & OCR Server

* Stub files under `apps/ocr-server` should define a minimal Express + Tesseract pipeline (to be implemented).
* `docker-compose.yml` will orchestrate the OCR container alongside the Next.js dev server in future iterations.

## Contributing

1. Fork the repo and clone locally.
2. Create a feature branch following `feature/...` naming.
3. Run `pnpm lint && pnpm test` before submitting a PR.
4. Document any new providers or settings.

---

### TO-DO: Production Integrations

* **TTS (Azure Cognitive Services)**

  * Install: `@azure/cognitiveservices-speech-sdk`
  * Env: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
  * Use SSML `<mark name="s{index}"/>` per sentence; capture `viseme/BookmarkReached` events → map to sentence indices.
  * Store audio to IndexedDB `audio` table; key = hash(provider, voice, text).
* **TTS (AWS Polly)**

  * Env: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
  * Use SpeechMarks to derive per-word timings; aggregate to sentence timings.
* **Translation (DeepL/OpenAI/Router)**

  * Implement `estimateCost(chars)` using provider pricing tables; block if over `budgetCents`.
  * Translate in batches aligned to **sentences**. Persist by `sentenceId`.
* **Dictionary (JMdict or Licensed)**

  * Script to import XML/JSON → IndexedDB table `jmdict_entries` (optional). Map to `Definition[]`.
  * Respect license terms; provide toggle in Settings.
* **Pitch Accent**

  * Expected schema for `PitchInfo`: `{ pattern:string; accents:number[] }`.
  * UI shows Tokyo pattern lines above reading when available.
* **OCR Server**

  * Build: `docker compose up -d ocr`
  * Env for web app: `OCR_SERVER_URL` → enables `/api/pdf/ocr` proxy.

### Demo Mode

* `NEXT_PUBLIC_PROVIDER=mock` enables mock translation/TTS/dictionary.
* Visit `/dev/seed` → **Seed Demo Data** → open your document and test.

### PWA Notes

* First load while online; then offline use for saved docs + SRS.
* Manage cache sizes in Settings; use **Clear caches** if storage quota prompts.
