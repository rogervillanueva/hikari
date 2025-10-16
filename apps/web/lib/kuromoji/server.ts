import { createRequire } from 'node:module';
import path from 'node:path';
import type { TokenizeResponseToken } from '@/workers/tokenize-ja';

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
  let kuromoji: unknown;
  try {
    const moduleName = process.env.KUROMOJI_MODULE ?? 'kuromoji';
    kuromoji = require(moduleName);
  } catch (error) {
    if (error instanceof KuromojiUnavailableError) {
      throw error;
    }
    throw new KuromojiUnavailableError('kuromoji module is not installed.', [
      'Install it with `pnpm --filter web add kuromoji @types/kuromoji@0.1.3` inside the repo.',
      'If you are using a custom tokenizer, set KUROMOJI_MODULE to its package name.',
    ], { cause: error });
  }

  const kuromojiNamespace = (kuromoji as { default?: unknown }).default ?? kuromoji;
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
