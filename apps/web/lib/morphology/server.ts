import { KuromojiUnavailableError, tokenizeWithKuromoji } from '@/lib/kuromoji/server';
import { SudachiUnavailableError, tokenizeWithSudachi } from '@/lib/sudachi/server';
import type { TokenizeResponseToken } from '@/workers/tokenize-ja';

export type MorphologySource = 'sudachi' | 'kuromoji';

export interface MorphologyDiagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
  help?: string[];
  source?: MorphologySource;
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
      diagnostics.push({
        level: 'warning',
        message: 'Sudachi tokenizer is unavailable. Falling back to kuromoji.',
        help: error.help,
        source: 'sudachi',
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
      diagnostics.push({
        level: 'error',
        message: 'Kuromoji fallback tokenizer is unavailable.',
        help: error.help,
        source: 'kuromoji',
      });
      throw new SudachiUnavailableError('No morphology tokenizer is available.', {
        cause: error,
        help: diagnostics.flatMap((item) => item.help ?? []),
      });
    }
    throw error;
  }
}
