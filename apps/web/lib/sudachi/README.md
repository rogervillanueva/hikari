# Sudachi integration

The Next.js API route under `app/api/morphology` loads the Sudachi dictionary from this directory
(or the path provided by the `SUDACHI_DICTIONARY_PATH` environment variable) and exposes a
`POST /api/morphology` endpoint that matches the `tokenize-ja` worker contract.

Place your extracted `system_full.dic` (or any other Sudachi dictionary) in this directory or point
`SUDACHI_DICTIONARY_PATH` at its location. The file is intentionally ignored by Git to avoid
committing large binary assets.

If Sudachi cannot be initialised, the API route falls back to a Kuromoji tokenizer. Install the
`kuromoji` package (and its type definitions) so the fallback remains available during development.
