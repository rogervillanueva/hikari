import type { TokenizeResponseToken } from '@/workers/tokenize-ja';

const SINGLE_PARTICLE_CHARS = new Set(['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'や', 'の', 'か']);
const STANDALONE_PARTICLES = new Set([
  'は',
  'が',
  'を',
  'に',
  'で',
  'へ',
  'と',
  'も',
  'や',
  'の',
  'か',
  'ね',
  'よ',
]);
const LONG_SOUND_MARKS = new Set(['ー', 'ｰ', '―', '—']);

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

const WORD_CHAR_PATTERN = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{Letter}\p{Number}]/u;

export function segmentWithIntl(text: string): TokenizeResponseToken[] | null {
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
      const isWordLike = segment.isWordLike ?? WORD_CHAR_PATTERN.test(surface);
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
      return null;
    }

    return segments;
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[morphology:fallback] Intl.Segmenter failed, falling back to heuristics', error);
    }
    return null;
  }
}

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

export function segmentWithHeuristics(text: string): TokenizeResponseToken[] {
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

export function tokenizeWithFallback(text: string): TokenizeResponseToken[] {
  return segmentWithIntl(text) ?? segmentWithHeuristics(text);
}
