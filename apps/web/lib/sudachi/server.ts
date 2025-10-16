import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TokenizeResponseToken } from '@/workers/tokenize-ja';

const SUDACHI_DEFAULT_MODULES = ['sudachi', '@sudachi/browser', '@sudachi/sudachi'] as const;
type NodeRequire = NodeJS.Require;
const DEFAULT_DICTIONARY_RELATIVE_PATHS = [
  path.join('lib', 'sudachi', 'system_full.dic'),
  path.join('apps', 'web', 'lib', 'sudachi', 'system_full.dic'),
];
const SUDACHI_SPLIT_MODE = (process.env.SUDACHI_SPLIT_MODE ?? 'C').toUpperCase();

export class SudachiUnavailableError extends Error {
  readonly help: string[];
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    options?: { cause?: unknown; help?: string[]; context?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'SudachiUnavailableError';
    if (options?.cause) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      (this as { cause?: unknown }).cause = options.cause;
    }
    this.help = options?.help ?? [];
    this.context = options?.context;
  }
}

interface SudachiHandle {
  tokenizer: SudachiTokenizerLike;
  module: unknown;
  splitMode: unknown;
}

type SudachiTokenizerLike = {
  tokenize: (...args: unknown[]) => unknown;
};

type SudachiTokenLike = Record<string, unknown>;

let tokenizerPromise: Promise<SudachiHandle> | null = null;
let cachedDictionaryBytes: Uint8Array | null = null;
let cachedDictionaryPath: string | null = null;

export async function tokenizeWithSudachi(text: string): Promise<TokenizeResponseToken[]> {
  const handle = await ensureSudachiTokenizer();
  const rawTokens = await runTokenizer(handle, text);
  return mapSudachiTokens(rawTokens);
}

async function ensureSudachiTokenizer(): Promise<SudachiHandle> {
  if (!tokenizerPromise) {
    tokenizerPromise = loadSudachiTokenizer();
  }
  return tokenizerPromise;
}

async function loadSudachiTokenizer(): Promise<SudachiHandle> {
  const dictionaryPath = await resolveDictionaryPath();
  const dictionaryBytes = await loadDictionaryBytes(dictionaryPath);
  const sudachiModule = await loadSudachiModule();
  const tokenizer = await instantiateTokenizer(sudachiModule, dictionaryBytes, dictionaryPath);
  const splitMode = resolveSplitMode(sudachiModule, SUDACHI_SPLIT_MODE);

  if (!tokenizer || typeof tokenizer.tokenize !== 'function') {
    throw new SudachiUnavailableError('Sudachi tokenizer did not expose a tokenize() function.', {
      help: [
        'Verify that the installed Sudachi module exports a callable tokenize() method.',
        'If you are using the sudachi WASM bindings, ensure you are running on Node.js 18+ with WebAssembly support.',
      ],
    });
  }

  return { tokenizer, module: sudachiModule, splitMode };
}

async function resolveDictionaryPath(): Promise<string> {
  if (cachedDictionaryPath) {
    return cachedDictionaryPath;
  }

  const explicit = process.env.SUDACHI_DICTIONARY_PATH;
  if (explicit) {
    try {
      await fs.access(explicit, fsConstants.R_OK);
      cachedDictionaryPath = explicit;
      return explicit;
    } catch (error) {
      throw new SudachiUnavailableError(`Sudachi dictionary not readable at ${explicit}.`, {
        cause: error,
        help: [
          `Update SUDACHI_DICTIONARY_PATH to point at your system_full.dic file.`,
          `Current working directory: ${process.cwd()}`,
        ],
      });
    }
  }

  const candidatePaths = DEFAULT_DICTIONARY_RELATIVE_PATHS.map((relativePath) =>
    path.resolve(process.cwd(), relativePath),
  );

  for (const candidate of candidatePaths) {
    try {
      await fs.access(candidate, fsConstants.R_OK);
      cachedDictionaryPath = candidate;
      return candidate;
    } catch {
      // Continue probing other candidates.
    }
  }

  const helpPaths = candidatePaths.map((candidate) => `- ${candidate}`);
  throw new SudachiUnavailableError('Sudachi dictionary file not found.', {
    help: [
      'Place your system_full.dic file in one of the default lookup locations:',
      ...helpPaths,
      'Alternatively set SUDACHI_DICTIONARY_PATH to the dictionary file location.',
      `Current working directory: ${process.cwd()}`,
    ],
  });
}

async function loadDictionaryBytes(dictionaryPath: string): Promise<Uint8Array> {
  if (!cachedDictionaryBytes) {
    const buffer = await fs.readFile(dictionaryPath);
    cachedDictionaryBytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }
  return cachedDictionaryBytes;
}

async function loadSudachiModule(): Promise<unknown> {
  const require = createRequire(import.meta.url);
  const errors: unknown[] = [];

  const override = process.env.SUDACHI_MODULE;
  if (override) {
    const overrideResult = await tryLoadSudachiOverride(override, require);
    if (overrideResult.ok) {
      return overrideResult.module;
    }
    errors.push(overrideResult.error);
  }

  const loaders: Array<() => Promise<{ ok: true; module: unknown } | { ok: false; error: unknown }>> = [
    () => tryLoadSudachiFromSudachi(require),
    () => tryLoadSudachiFromBrowser(require),
    () => tryLoadSudachiFromScoped(require),
  ];

  for (const load of loaders) {
    const result = await load();
    if (result.ok) {
      return result.module;
    }
    errors.push(result.error);
  }

  const attemptedModules = override
    ? [override, ...SUDACHI_DEFAULT_MODULES]
    : [...SUDACHI_DEFAULT_MODULES];

  throw new SudachiUnavailableError('Sudachi module is not installed.', {
    cause: errors[errors.length - 1],
    help: [
      'Install the WASM bindings by running `pnpm --filter web add sudachi` inside the repo.',
      'If you are vendoring another Sudachi-compatible module, set SUDACHI_MODULE to its package name.',
    ],
    context: { attemptedModules },
  });
}

function isRequireEsmError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'ERR_REQUIRE_ESM';
}

async function tryLoadSudachiOverride(moduleName: string, require: NodeRequire) {
  try {
    return { ok: true as const, module: require(moduleName) };
  } catch (error) {
    if (isRequireEsmError(error)) {
      try {
        // eslint-disable-next-line import/no-dynamic-require, @typescript-eslint/no-unsafe-assignment
        const module = await import(/* webpackIgnore: true */ moduleName);
        return { ok: true as const, module };
      } catch (innerError) {
        return { ok: false as const, error: innerError };
      }
    }
    return { ok: false as const, error };
  }
}

async function tryLoadSudachiFromSudachi(require: NodeRequire) {
  const moduleName = 'sudachi';
  const resolved = resolveOptionalModule(require, moduleName);
  if (!resolved) {
    return { ok: false as const, error: createModuleNotFoundError(moduleName) };
  }

  try {
    const module = loadCommonJsModule(require, resolved);
    return { ok: true as const, module };
  } catch (error) {
    if (isRequireEsmError(error)) {
      try {
        const module = await importResolvedModule(resolved);
        return { ok: true as const, module };
      } catch (innerError) {
        return { ok: false as const, error: innerError };
      }
    }
    return { ok: false as const, error };
  }
}

async function tryLoadSudachiFromBrowser(require: NodeRequire) {
  const moduleName = ['@sudachi', 'browser'].join('/');
  const resolved = resolveOptionalModule(require, moduleName);
  if (!resolved) {
    return { ok: false as const, error: createModuleNotFoundError(moduleName) };
  }

  try {
    const module = loadCommonJsModule(require, resolved);
    return { ok: true as const, module };
  } catch (error) {
    if (isRequireEsmError(error)) {
      try {
        const module = await importResolvedModule(resolved);
        return { ok: true as const, module };
      } catch (innerError) {
        return { ok: false as const, error: innerError };
      }
    }
    return { ok: false as const, error };
  }
}

async function tryLoadSudachiFromScoped(require: NodeRequire) {
  const moduleName = ['@sudachi', 'sudachi'].join('/');
  const resolved = resolveOptionalModule(require, moduleName);
  if (!resolved) {
    return { ok: false as const, error: createModuleNotFoundError(moduleName) };
  }

  try {
    const module = loadCommonJsModule(require, resolved);
    return { ok: true as const, module };
  } catch (error) {
    if (isRequireEsmError(error)) {
      try {
        const module = await importResolvedModule(resolved);
        return { ok: true as const, module };
      } catch (innerError) {
        return { ok: false as const, error: innerError };
      }
    }
    return { ok: false as const, error };
  }
}

function loadCommonJsModule(require: NodeRequire, resolvedPath: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, import/no-dynamic-require
  return require(resolvedPath);
}

async function importResolvedModule(resolvedPath: string): Promise<unknown> {
  const url = pathToFileURL(resolvedPath).href;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return import(url);
}

function resolveOptionalModule(require: NodeRequire, moduleName: string): string | null {
  try {
    return require.resolve(moduleName);
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function createModuleNotFoundError(moduleName: string): Error {
  const error = new Error(`Module not found: ${moduleName}`);
  (error as { code?: string }).code = 'MODULE_NOT_FOUND';
  return error;
}

function isModuleNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'MODULE_NOT_FOUND';
}

async function instantiateTokenizer(
  sudachiModule: unknown,
  dictionaryBytes: Uint8Array,
  dictionaryPath: string,
): Promise<SudachiTokenizerLike | null> {
  const moduleCandidates = resolveModuleCandidates(sudachiModule);
  const dictionaryCandidates: unknown[] = [
    { dictionary: dictionaryBytes },
    { dictionary: dictionaryBytes, mode: SUDACHI_SPLIT_MODE },
    { dictionary: dictionaryBytes, splitMode: SUDACHI_SPLIT_MODE },
    dictionaryBytes,
    dictionaryBytes.buffer,
    dictionaryPath,
  ];

  for (const candidate of moduleCandidates) {
    if (typeof candidate !== 'function') {
      continue;
    }

    for (const dictionaryOption of dictionaryCandidates) {
      try {
        const maybeTokenizer = await candidate.call(sudachiModule, dictionaryOption);
        if (maybeTokenizer && typeof (maybeTokenizer as SudachiTokenizerLike).tokenize === 'function') {
          return maybeTokenizer as SudachiTokenizerLike;
        }
      } catch (error) {
        // Try the next combination.
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[sudachi] failed to instantiate tokenizer with option', dictionaryOption, error);
        }
      }
    }
  }

  // Some modules expect dictionary objects to be created explicitly before instantiating the tokenizer.
  const dictionaryFactories = resolveDictionaryFactories(sudachiModule);
  for (const factory of dictionaryFactories) {
    if (typeof factory !== 'function') {
      continue;
    }

    try {
      const dictionary = await factory.call(sudachiModule, dictionaryBytes);
      if (!dictionary) {
        continue;
      }
      for (const candidate of moduleCandidates) {
        if (typeof candidate !== 'function') {
          continue;
        }
        try {
          const maybeTokenizer = await candidate.call(sudachiModule, dictionary);
          if (maybeTokenizer && typeof (maybeTokenizer as SudachiTokenizerLike).tokenize === 'function') {
            return maybeTokenizer as SudachiTokenizerLike;
          }
        } catch (error) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[sudachi] tokenizer factory failed after building dictionary', error);
          }
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[sudachi] dictionary factory failed', error);
      }
    }
  }

  return null;
}

function resolveModuleCandidates(module: unknown): Array<(...args: unknown[]) => unknown> {
  const candidates: Array<(...args: unknown[]) => unknown> = [];
  const maybeModule = asRecord(module);
  if (!maybeModule) {
    return candidates;
  }
  const defaultExport = asRecord(maybeModule.default);
  const tokenizerNamespace = asRecord(maybeModule.tokenizer);
  const tokenizerExport = maybeModule.Tokenizer;
  const defaultTokenizerExport = defaultExport?.Tokenizer;
  const defaultTokenizerNamespace = asRecord(defaultTokenizerExport);

  const pushIfFunction = (value: unknown) => {
    if (typeof value === 'function') {
      candidates.push(value as (...args: unknown[]) => unknown);
    }
  };

  pushIfFunction(maybeModule.createTokenizer);
  pushIfFunction(tokenizerNamespace?.create);
  pushIfFunction(tokenizerNamespace?.fromDictionary);
  pushIfFunction(asRecord(tokenizerExport)?.create);
  pushIfFunction(tokenizerExport);
  pushIfFunction(defaultExport);
  pushIfFunction(defaultExport?.createTokenizer);
  pushIfFunction(defaultTokenizerNamespace?.create);
  pushIfFunction(defaultTokenizerExport);

  return candidates;
}

function resolveDictionaryFactories(module: unknown): Array<(...args: unknown[]) => unknown> {
  const factories: Array<(...args: unknown[]) => unknown> = [];
  const maybeModule = asRecord(module);
  if (!maybeModule) {
    return factories;
  }
  const defaultExport = asRecord(maybeModule.default);
  const dictionaryNamespace = asRecord(maybeModule.Dictionary);
  const dictionaryExport = maybeModule.Dictionary;
  const defaultDictionaryExport = defaultExport?.Dictionary;
  const defaultDictionaryNamespace = asRecord(defaultDictionaryExport);

  const pushIfFunction = (value: unknown) => {
    if (typeof value === 'function') {
      factories.push(value as (...args: unknown[]) => unknown);
    }
  };

  pushIfFunction(maybeModule.createDictionary);
  pushIfFunction(dictionaryNamespace?.fromBytes);
  pushIfFunction(dictionaryNamespace?.fromBuffer);
  pushIfFunction(dictionaryExport);
  pushIfFunction(defaultExport?.createDictionary);
  pushIfFunction(defaultDictionaryNamespace?.fromBytes);
  pushIfFunction(defaultDictionaryNamespace?.fromBuffer);
  pushIfFunction(defaultDictionaryExport);

  return factories;
}

async function runTokenizer(handle: SudachiHandle, text: string): Promise<SudachiTokenLike[]> {
  const { tokenizer, splitMode } = handle;
  const attempts: unknown[][] = splitMode !== undefined ? [[text, splitMode], [text]] : [[text]];
  let lastError: unknown;

  for (const args of attempts) {
    try {
      const result = await maybePromise(tokenizer.tokenize(...args));
      if (Array.isArray(result)) {
        return result as SudachiTokenLike[];
      }
      if (result && typeof result === 'object' && Symbol.iterator in result) {
        return Array.from(result as Iterable<unknown>) as SudachiTokenLike[];
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new SudachiUnavailableError('Sudachi tokenizer could not segment the provided text.', {
    cause: lastError,
    help: [
      'Ensure the Sudachi WASM bindings support tokenize(text, splitMode) and tokenize(text).',
      'If you are using a CLI wrapper, expose a tokenize method compatible with this API.',
    ],
  });
}

function resolveSplitMode(module: unknown, desired: string): unknown {
  const modeKey = desired.toUpperCase();
  const moduleRecord = asRecord(module);
  const defaultExport = asRecord(moduleRecord?.default);
  const tokenizerNamespace = asRecord(moduleRecord?.Tokenizer);
  const defaultTokenizerNamespace = asRecord(defaultExport?.Tokenizer);
  const candidateContainers = [
    moduleRecord?.SplitMode,
    moduleRecord?.Mode,
    tokenizerNamespace?.SplitMode,
    moduleRecord?.TokenizerMode,
    defaultExport?.SplitMode,
    defaultExport?.Mode,
    defaultTokenizerNamespace?.SplitMode,
    defaultExport?.TokenizerMode,
  ];

  for (const container of candidateContainers) {
    if (!container || typeof container !== 'object') {
      continue;
    }
    const lookup = container as Record<string, unknown>;
    const lowerKey = modeKey.toLowerCase();
    const direct = lookup[modeKey] ?? lookup[lowerKey];
    if (direct !== undefined) {
      return direct;
    }
  }

  return modeKey;
}

function maybePromise<T>(value: T | Promise<T>): Promise<T> {
  return value instanceof Promise ? value : Promise.resolve(value);
}

function pickTokenValue(token: SudachiTokenLike, candidates: string[]): unknown {
  for (const key of candidates) {
    const value = token[key];
    if (typeof value === 'function') {
      try {
        const result = value.call(token);
        if (result !== undefined && result !== null && result !== '') {
          return result;
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[sudachi] token method failed', key, error);
        }
      }
    } else if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed && trimmed !== '*' ? trimmed : undefined;
  }
  if (typeof value === 'number') {
    const str = String(value);
    return str.trim() ? str : undefined;
  }
  if (value && typeof value === 'object') {
    const candidate =
      (value as { name?: unknown }).name ??
      (value as { value?: unknown }).value ??
      (value as { label?: unknown }).label ??
      (value as { toString?: () => unknown }).toString?.();
    return normalizeString(candidate);
  }
  return undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const entries = value
      .map((item) => normalizeString(item))
      .filter((entry): entry is string => Boolean(entry));
    return entries.length ? entries : undefined;
  }
  if (typeof value === 'string') {
    const entries = value
      .split(/[、,]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return entries.length ? entries : undefined;
  }
  return undefined;
}

const NON_WORDLIKE_POS = new Set(['補助記号', '空白', '記号']);

export function mapSudachiTokens(rawTokens: unknown): TokenizeResponseToken[] {
  if (!Array.isArray(rawTokens)) {
    return [];
  }

  const tokens: TokenizeResponseToken[] = [];

  for (const rawToken of rawTokens) {
    if (!rawToken || typeof rawToken !== 'object') {
      continue;
    }
    const token = rawToken as SudachiTokenLike;

    const surface = normalizeString(
      pickTokenValue(token, ['surface', 'surfaceForm', 'surface_form', 'literal']) ??
        (token as { toString?: () => unknown }).toString?.(),
    );
    if (!surface) {
      continue;
    }

    const base =
      normalizeString(
        pickTokenValue(token, [
          'dictionaryForm',
          'dictionary_form',
          'basicForm',
          'basic_form',
          'lemma',
          'normalizedForm',
          'normalized_form',
        ]),
      ) ?? surface;

    const reading = normalizeString(pickTokenValue(token, ['readingForm', 'reading_form', 'reading', 'pronunciation']));

    const posList =
      normalizeStringArray(pickTokenValue(token, ['partOfSpeech', 'part_of_speech', 'pos', 'posDetail'])) ?? [];

    const conjugationType = normalizeString(
      pickTokenValue(token, ['inflectionType', 'inflection_type', 'conjugationType', 'conjugation_type']),
    );
    const conjugationForm = normalizeString(
      pickTokenValue(token, ['inflectionForm', 'inflection_form', 'conjugationForm', 'conjugation_form']),
    );

    const isWordLike = determineWordLike(surface, posList);

    tokens.push({
      surface,
      base,
      reading,
      pos: posList.length ? posList.join(' • ') : undefined,
      features: posList.length ? posList : undefined,
      conjugation:
        conjugationType || conjugationForm
          ? {
              type: conjugationType,
              form: conjugationForm,
            }
          : undefined,
      isWordLike,
    });
  }

  return tokens;
}

function determineWordLike(surface: string, posList: string[]): boolean {
  if (!surface.trim()) {
    return false;
  }
  if (!posList.length) {
    return true;
  }
  return !NON_WORDLIKE_POS.has(posList[0]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return undefined;
}
