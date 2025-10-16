import type { PitchInfo } from '@/lib/types';

export interface TokenizeRequest {
  text: string;
}

export interface TokenizeResponseToken {
  surface: string;
  base?: string;
  reading?: string;
  pos?: string;
  features?: string[];
  conjugation?: {
    type?: string;
    form?: string;
    description?: string;
  };
  pitch?: PitchInfo;
  isWordLike?: boolean;
}

export interface TokenizeResponse {
  tokens: TokenizeResponseToken[];
}

interface RemoteTokenPayload extends TokenizeResponseToken {
  pos?: string | string[];
  features?: string[];
}

export interface MorphologyDiagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
  help?: string[];
  source?: string;
}

type MorphologyDiagnosticsListener = (diagnostic: MorphologyDiagnostic) => void;

const morphologyDiagnosticsListeners = new Set<MorphologyDiagnosticsListener>();

export function subscribeToMorphologyDiagnostics(listener: MorphologyDiagnosticsListener): () => void {
  morphologyDiagnosticsListeners.add(listener);
  return () => {
    morphologyDiagnosticsListeners.delete(listener);
  };
}

function emitMorphologyDiagnostic(diagnostic: MorphologyDiagnostic) {
  if (!diagnostic.message) {
    return;
  }
  morphologyDiagnosticsListeners.forEach((listener) => {
    try {
      listener(diagnostic);
    } catch (error) {
      console.error('[tokenize-ja] morphology diagnostics listener failed', error);
    }
  });
}

const MORPHOLOGY_ENDPOINT = process.env.NEXT_PUBLIC_MORPHOLOGY_ENDPOINT;
const MORPHOLOGY_API_KEY = process.env.NEXT_PUBLIC_MORPHOLOGY_API_KEY;

export async function tokenizeJapanese({ text }: TokenizeRequest): Promise<TokenizeResponse> {
  const trimmed = text.trim();
  if (!trimmed.length) {
    return { tokens: [] };
  }

  const remote = await tryRemoteTokenizer(trimmed);
  if (remote) {
    return { tokens: remote };
  }

  const local = segmentWithIntl(trimmed) ?? segmentWithHeuristics(trimmed);
  return { tokens: local };
}

async function tryRemoteTokenizer(text: string): Promise<TokenizeResponseToken[] | null> {
  if (!MORPHOLOGY_ENDPOINT) {
    return null;
  }
  try {
    const response = await fetch(MORPHOLOGY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(MORPHOLOGY_API_KEY ? { 'X-API-Key': MORPHOLOGY_API_KEY } : {}),
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      let details: { error?: string; help?: string[] } | null = null;
      try {
        details = (await response.json()) as { error?: string; help?: string[] } | null;
      } catch (error) {
        // Ignore body parsing errors and fall back to a generic message.
      }
      const message = details?.error ?? `Remote tokenizer returned status ${response.status}.`;
      emitMorphologyDiagnostic({ level: 'error', message, help: details?.help });
      console.warn('[tokenize-ja] remote tokenizer returned', response.status);
      return null;
    }

    const payload = (await response.json()) as {
      tokens?: RemoteTokenPayload[];
      diagnostics?: MorphologyDiagnostic[];
      source?: string;
    } | null;

    if (payload?.diagnostics?.length) {
      payload.diagnostics.forEach((diagnostic) => emitMorphologyDiagnostic(diagnostic));
    }

    if (!payload?.tokens?.length) {
      return null;
    }

    if (looksLikePerCharacterSegmentation(payload.tokens, text)) {
      console.warn('[tokenize-ja] remote tokenizer returned low-quality segmentation, falling back');
      emitMorphologyDiagnostic({
        level: 'warning',
        message: 'Remote tokenizer returned low-quality segmentation. Falling back to heuristics.',
        source: payload?.source,
      });
      return null;
    }

    return payload.tokens.map((token) => {
      const posList = Array.isArray(token.pos)
        ? token.pos.filter((entry) => !!entry)
        : token.pos
        ? [token.pos]
        : [];
      const features = token.features ?? posList;
      return {
        surface: token.surface,
        base: token.base ?? token.surface,
        reading: token.reading,
        pos: posList.length ? posList.join(' • ') : undefined,
        features,
        conjugation: token.conjugation,
        pitch: token.pitch,
        isWordLike: token.isWordLike ?? true,
      } satisfies TokenizeResponseToken;
    });
  } catch (error) {
    console.error('[tokenize-ja] remote tokenizer failed', error);
    emitMorphologyDiagnostic({
      level: 'error',
      message: 'Failed to reach remote tokenizer. Falling back to heuristics.',
      help: [error instanceof Error ? error.message : String(error)],
    });
    return null;
  }
}

const JAPANESE_CHAR_REGEX = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u;

function looksLikePerCharacterSegmentation(tokens: RemoteTokenPayload[], originalText: string): boolean {
  const meaningfulTokens = tokens
    .map((token) => token.surface?.trim() ?? '')
    .filter((surface) => surface.length > 0);

  if (!meaningfulTokens.length) {
    return true;
  }

  const japaneseTokens = meaningfulTokens.filter((surface) => JAPANESE_CHAR_REGEX.test(surface));
  if (japaneseTokens.length < 4) {
    return false;
  }

  const lengths = japaneseTokens.map((surface) => Array.from(surface).length);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const averageLength = totalLength / lengths.length;
  const singleCharCount = lengths.filter((length) => length === 1).length;
  const singleCharRatio = singleCharCount / lengths.length;

  if (averageLength > 1.7 && singleCharRatio < 0.6) {
    return false;
  }

  const originalJapaneseLength = Array.from(originalText).filter((char) => JAPANESE_CHAR_REGEX.test(char)).length;
  return originalJapaneseLength > 4;
}

function segmentWithIntl(text: string): TokenizeResponseToken[] | null {
  if (typeof Intl === 'undefined' || typeof (Intl as never).Segmenter !== 'function') {
    return null;
  }
  try {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    const segments: TokenizeResponseToken[] = [];
    let wordLikeCount = 0;
    let totalWordLikeLength = 0;
    for (const segment of segmenter.segment(text)) {
      const surface = segment.segment;
      const isWordLike =
        segment.isWordLike ?? /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{Letter}\p{Number}]/u.test(surface);
      segments.push({ surface, isWordLike });
      if (isWordLike) {
        wordLikeCount += 1;
        totalWordLikeLength += surface.length;
      }
    }
    if (!segments.length) {
      return null;
    }
    const averageLength = wordLikeCount ? totalWordLikeLength / wordLikeCount : 0;
    if (wordLikeCount && averageLength < 1.5) {
      // Intl.Segmenter tends to split into individual characters for Japanese text
      // when no dictionary data is available. Fall back to heuristics in that case.
      return null;
    }
    return segments;
  } catch (error) {
    console.warn('[tokenize-ja] Intl.Segmenter failed, falling back to heuristic segmentation', error);
    return null;
  }
}

type TokenCategory =
  | 'kanji'
  | 'hiragana'
  | 'katakana'
  | 'mixed'
  | 'latin'
  | 'number'
  | 'space'
  | 'punct'
  | 'other';

interface BufferToken {
  surface: string;
  type: TokenCategory;
  isWordLike: boolean;
  precededByWord: boolean;
}

const SINGLE_PARTICLE_CHARS = new Set(['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'や', 'の', 'か']);
const STANDALONE_PARTICLES = new Set(['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'や', 'の', 'か', 'ね', 'よ']);
const LONG_SOUND_MARKS = new Set(['ー', 'ｰ', '―', '—']);

function isWordCategory(category: TokenCategory): boolean {
  return category !== 'space' && category !== 'punct' && category !== 'other';
}

function categorizeChar(char: string): TokenCategory {
  if (/\p{White_Space}/u.test(char)) {
    return 'space';
  }
  if (/[一-龯々〆ヵヶ]/u.test(char)) {
    return 'kanji';
  }
  if (/\p{sc=Hiragana}/u.test(char)) {
    return 'hiragana';
  }
  if (/\p{sc=Katakana}/u.test(char) || LONG_SOUND_MARKS.has(char)) {
    return 'katakana';
  }
  if (char === "'" || char === '’' || char === '-' || char === '‐') {
    return 'latin';
  }
  if (/[A-Za-zＡ-Ｚａ-ｚ]/u.test(char)) {
    return 'latin';
  }
  if (/[0-9０-９]/u.test(char)) {
    return 'number';
  }
  if (/\p{Punctuation}/u.test(char)) {
    return 'punct';
  }
  return 'other';
}

function isStandaloneParticle(buffer: BufferToken): boolean {
  if (!buffer.precededByWord) {
    return false;
  }
  if (buffer.surface.length > 2) {
    return false;
  }
  return STANDALONE_PARTICLES.has(buffer.surface);
}

function shouldMerge(buffer: BufferToken, nextChar: string, nextCategory: TokenCategory): boolean {
  const nextIsWord = isWordCategory(nextCategory);
  if (!buffer.isWordLike || !nextIsWord) {
    return buffer.isWordLike === nextIsWord && buffer.type === nextCategory;
  }

  if (isStandaloneParticle(buffer)) {
    return false;
  }

  if (buffer.type === 'kanji') {
    if (nextCategory === 'kanji') {
      return true;
    }
    if (nextCategory === 'hiragana' || nextCategory === 'katakana') {
      if (SINGLE_PARTICLE_CHARS.has(nextChar)) {
        return false;
      }
      return true;
    }
    return false;
  }

  if (buffer.type === 'mixed') {
    if (nextCategory === 'hiragana' || nextCategory === 'katakana') {
      if (SINGLE_PARTICLE_CHARS.has(nextChar)) {
        return false;
      }
      return true;
    }
    return false;
  }

  if (buffer.type === 'hiragana') {
    const bufferIsParticle = isStandaloneParticle(buffer);
    if (nextCategory === 'hiragana') {
      if (bufferIsParticle && buffer.surface.length === 1) {
        return false;
      }
      return true;
    }
    if (nextCategory === 'katakana') {
      return true;
    }
    return false;
  }

  if (buffer.type === 'katakana') {
    if (nextCategory === 'katakana') {
      return true;
    }
    if (LONG_SOUND_MARKS.has(nextChar)) {
      return true;
    }
    return false;
  }

  if (buffer.type === 'latin') {
    if (nextCategory === 'latin' || nextCategory === 'number') {
      return true;
    }
    if (nextChar === "'" || nextChar === '’' || nextChar === '-' || nextChar === '‐') {
      return true;
    }
    return false;
  }

  if (buffer.type === 'number') {
    if (nextCategory === 'number') {
      return true;
    }
    if (nextChar === '.' || nextChar === ',' || nextChar === '．' || nextChar === '，') {
      return true;
    }
    return false;
  }

  return false;
}

function mergeIntoBuffer(buffer: BufferToken, char: string, category: TokenCategory) {
  buffer.surface += char;
  if (buffer.type === 'kanji' && (category === 'hiragana' || category === 'katakana')) {
    buffer.type = 'mixed';
  } else if (buffer.type === 'mixed' && category === 'kanji') {
    buffer.type = 'mixed';
  } else if (buffer.type === 'hiragana' && category === 'katakana') {
    buffer.type = 'mixed';
  } else if (buffer.type === 'katakana' && category === 'hiragana') {
    buffer.type = 'mixed';
  } else if (buffer.type === 'latin' && category === 'number') {
    buffer.type = 'latin';
  } else if (buffer.type === 'number' && category === 'latin') {
    buffer.type = 'latin';
  }
  buffer.isWordLike = buffer.isWordLike || isWordCategory(category);
}

function segmentWithHeuristics(text: string): TokenizeResponseToken[] {
  const tokens: TokenizeResponseToken[] = [];
  let buffer: BufferToken | null = null;
  let lastTokenWasWord = false;

  const flush = () => {
    if (!buffer) {
      return;
    }
    tokens.push({ surface: buffer.surface, isWordLike: buffer.isWordLike });
    lastTokenWasWord = buffer.isWordLike;
    buffer = null;
  };

  for (const char of Array.from(text)) {
    const category = categorizeChar(char);
    const isWordLike = isWordCategory(category);
    if (!buffer) {
      buffer = {
        surface: char,
        type: category,
        isWordLike,
        precededByWord: lastTokenWasWord,
      };
      continue;
    }

    if (shouldMerge(buffer, char, category)) {
      mergeIntoBuffer(buffer, char, category);
      continue;
    }

    flush();
    buffer = {
      surface: char,
      type: category,
      isWordLike,
      precededByWord: lastTokenWasWord,
    };
  }

  flush();

  if (!tokens.length) {
    return [{ surface: text, isWordLike: true }];
  }

  return tokens;
}
