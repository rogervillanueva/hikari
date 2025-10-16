import { buildDiagnosticLog, serializeError } from '@/lib/morphology/diagnostics';
import { KuromojiUnavailableError, tokenizeWithKuromoji } from '@/lib/kuromoji/server';
import { SudachiUnavailableError, tokenizeWithSudachi } from '@/lib/sudachi/server';
import type { TokenizeResponseToken } from '@/workers/tokenize-ja';

export type MorphologySource = 'sudachi' | 'kuromoji';

export interface MorphologyDiagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
  help?: string[];
  source?: MorphologySource;
  log?: string;
  timestamp?: string;
}

export interface MorphologyResult {
  tokens: TokenizeResponseToken[];
  source: MorphologySource;
  diagnostics: MorphologyDiagnostic[];
}

export async function tokenizeJapaneseServer(text: string): Promise<MorphologyResult> {
  const diagnostics: MorphologyDiagnostic[] = [];

  try {
    const tokens = await tokenizeWithSudachi(text);
    return { tokens, source: 'sudachi', diagnostics };
  } catch (error) {
    if (error instanceof SudachiUnavailableError) {
      const timestamp = new Date().toISOString();
      diagnostics.push({
        level: 'warning',
        message: 'Sudachi tokenizer is unavailable. Falling back to kuromoji.',
        help: error.help,
        source: 'sudachi',
        timestamp,
        log: buildDiagnosticLog({
          message: 'Sudachi tokenizer is unavailable. Falling back to kuromoji.',
          help: error.help,
          source: 'sudachi',
          timestamp,
          details: {
            splitMode: process.env.SUDACHI_SPLIT_MODE ?? 'C',
            dictionaryPath: process.env.SUDACHI_DICTIONARY_PATH ?? null,
            error: serializeError(error),
          },
        }),
      });
    } else {
      throw error;
    }
  }

  try {
    const tokens = await tokenizeWithKuromoji(text);
    return { tokens, source: 'kuromoji', diagnostics };
  } catch (error) {
    if (error instanceof KuromojiUnavailableError) {
      const timestamp = new Date().toISOString();
      diagnostics.push({
        level: 'error',
        message: 'Kuromoji fallback tokenizer is unavailable.',
        help: error.help,
        source: 'kuromoji',
        timestamp,
        log: buildDiagnosticLog({
          message: 'Kuromoji fallback tokenizer is unavailable.',
          help: error.help,
          source: 'kuromoji',
          timestamp,
          details: {
            module: process.env.KUROMOJI_MODULE ?? 'kuromoji',
            error: serializeError(error),
          },
        }),
      });
      throw new SudachiUnavailableError('No morphology tokenizer is available.', {
        cause: error,
        help: diagnostics.flatMap((item) => item.help ?? []),
        context: {
          diagnostics,
          kuromoji: serializeError(error),
        },
      });
    }
    throw error;
  }
}
