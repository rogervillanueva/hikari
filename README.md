# hikari

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
