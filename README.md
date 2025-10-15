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
