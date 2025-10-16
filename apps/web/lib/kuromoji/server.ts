import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TokenizeResponseToken } from '@/workers/tokenize-ja';

type NodeRequire = NodeJS.Require;

const DEFAULT_DIC_PATH = path.join(process.cwd(), 'node_modules/kuromoji/dict');

export class KuromojiUnavailableError extends Error {
  constructor(message: string, public readonly help: string[] = [], options?: { cause?: unknown }) {
    super(message);
    this.name = 'KuromojiUnavailableError';
    if (options?.cause) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

interface KuromojiTokenizerLike {
  tokenize: (text: string) => KuromojiTokenLike[];
}

interface KuromojiTokenLike {
  surface_form?: string;
  surface_form_original?: string;
  basic_form?: string;
  dictionary_form?: string;
  reading?: string;
  pronunciation?: string;
  pos?: string;
  pos_detail_1?: string;
  pos_detail_2?: string;
  pos_detail_3?: string;
}

let tokenizerPromise: Promise<KuromojiTokenizerLike> | null = null;

export async function tokenizeWithKuromoji(text: string): Promise<TokenizeResponseToken[]> {
  const tokenizer = await ensureTokenizer();
  const tokens = tokenizer.tokenize(text);
  return tokens
    .map(mapToken)
    .filter((token): token is TokenizeResponseToken => token !== null);
}

async function ensureTokenizer(): Promise<KuromojiTokenizerLike> {
  if (!tokenizerPromise) {
    tokenizerPromise = loadTokenizer();
  }
  return tokenizerPromise;
}

async function loadTokenizer(): Promise<KuromojiTokenizerLike> {
  const require = createRequire(import.meta.url);
  const override = process.env.KUROMOJI_MODULE;

  const results: Array<{ ok: true; module: unknown } | { ok: false; error: unknown }> = [];

  if (override) {
    results.push(await tryLoadKuromojiOverride(override, require));
  }

  results.push(await tryLoadKuromojiDefault(require));

  const resolved = results.find((result): result is { ok: true; module: unknown } => result.ok);
  if (!resolved) {
    const lastAttempt = results[results.length - 1];
    const lastError = lastAttempt && !lastAttempt.ok ? lastAttempt.error : undefined;
    throw new KuromojiUnavailableError('kuromoji module is not installed.', [
      'Install it with `pnpm --filter web add kuromoji @types/kuromoji@0.1.3` inside the repo.',
      'If you are using a custom tokenizer, set KUROMOJI_MODULE to its package name.',
    ], { cause: lastError });
  }

  const kuromojiNamespace = (resolved.module as { default?: unknown }).default ?? resolved.module;
  if (!kuromojiNamespace || typeof (kuromojiNamespace as { builder?: unknown }).builder !== 'function') {
    throw new KuromojiUnavailableError('kuromoji module did not expose a builder function.');
  }

  const builder = (kuromojiNamespace as { builder: (options: { dicPath: string }) => unknown }).builder({
    dicPath: DEFAULT_DIC_PATH,
  }) as {
    build: (callback: (error: unknown, tokenizer: KuromojiTokenizerLike) => void) => void;
  };

  return await new Promise<KuromojiTokenizerLike>((resolve, reject) => {
    builder.build((error: unknown, tokenizer: KuromojiTokenizerLike) => {
      if (error) {
        reject(
          new KuromojiUnavailableError('Failed to build kuromoji tokenizer.', [
            `Ensure the kuromoji dictionary exists at ${DEFAULT_DIC_PATH}.`,
          ], { cause: error }),
        );
        return;
      }
      resolve(tokenizer);
    });
  });
}

function mapToken(token: KuromojiTokenLike): TokenizeResponseToken | null {
  const surface = token.surface_form ?? token.surface_form_original;
  if (!surface || !surface.trim()) {
    return null;
  }

  const base = token.basic_form && token.basic_form !== '*'
    ? token.basic_form
    : token.dictionary_form && token.dictionary_form !== '*'
    ? token.dictionary_form
    : surface;

  const reading = token.reading && token.reading !== '*' ? token.reading : token.pronunciation;

  const posDetails = [token.pos, token.pos_detail_1, token.pos_detail_2, token.pos_detail_3]
    .map((part) => (part && part !== '*' ? part : null))
    .filter((part): part is string => !!part);

  const pos = posDetails.length ? posDetails.slice(0, 2).join(' • ') : undefined;

  const isWordLike = !(token.pos === '記号');

  return {
    surface,
    base,
    reading: reading && reading !== '*' ? reading : undefined,
    pos,
    features: posDetails,
    isWordLike,
  } satisfies TokenizeResponseToken;
}

function isRequireEsmError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'ERR_REQUIRE_ESM';
}

async function tryLoadKuromojiOverride(moduleName: string, require: NodeRequire) {
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

async function tryLoadKuromojiDefault(require: NodeRequire) {
  const moduleName = 'kuromoji';
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

function loadCommonJsModule(require: NodeRequire, resolvedPath: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, import/no-dynamic-require
  return require(resolvedPath);
}

async function importResolvedModule(resolvedPath: string): Promise<unknown> {
  const url = pathToFileURL(resolvedPath).href;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  return import(url);
}

function isModuleNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'MODULE_NOT_FOUND';
}

function createModuleNotFoundError(moduleName: string): Error {
  const error = new Error(`Module not found: ${moduleName}`);
  (error as { code?: string }).code = 'MODULE_NOT_FOUND';
  return error;
}
