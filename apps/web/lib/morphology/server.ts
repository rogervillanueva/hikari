import type { TokenizeResponseToken, TokenizeResponse } from '@/workers/tokenize-ja';

export type MorphologySource = 'sudachi' | 'kuromoji' | 'fallback';

export interface MorphologyDiagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
  help?: string[];
  source?: MorphologySource;
  log?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface MorphologyResult {
  tokens: TokenizeResponseToken[];
  source: MorphologySource;
  diagnostics: MorphologyDiagnostic[];
}

// Simplified stub function to get the app working
export async function tokenizeJapanese(text: string): Promise<MorphologyResult> {
  const diagnostics: MorphologyDiagnostic[] = [];
  
  diagnostics.push({
    level: 'info',
    message: 'Using fallback tokenization (morphology services temporarily disabled)',
    source: 'fallback',
  });

  // Return basic fallback tokens
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const tokens: TokenizeResponseToken[] = words.map((word, index) => ({
    surface: word,
    reading: word,
    base_form: word,
    part_of_speech: 'unknown',
  }));

  return { tokens, source: 'fallback', diagnostics };
}
