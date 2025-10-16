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

  return { tokens: segmentWithIntl(trimmed) };
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
      console.warn('[tokenize-ja] remote tokenizer returned', response.status);
      return null;
    }

    const payload = (await response.json()) as { tokens?: RemoteTokenPayload[] } | null;
    if (!payload?.tokens?.length) {
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
    return null;
  }
}

function segmentWithIntl(text: string): TokenizeResponseToken[] {
  const segments: TokenizeResponseToken[] = [];
  if (typeof Intl !== 'undefined' && typeof (Intl as never).Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
      for (const segment of segmenter.segment(text)) {
        segments.push({
          surface: segment.segment,
          isWordLike:
            segment.isWordLike ?? /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{Letter}\p{Number}]/u.test(segment.segment),
        });
      }
      if (segments.length) {
        return segments;
      }
    } catch (error) {
      console.warn('[tokenize-ja] Intl.Segmenter failed, falling back to heuristic segmentation', error);
    }
  }

  const fallback: TokenizeResponseToken[] = [];
  let buffer = '';
  let bufferIsWord = false;
  const flush = () => {
    if (!buffer) {
      return;
    }
    fallback.push({ surface: buffer, isWordLike: bufferIsWord });
    buffer = '';
    bufferIsWord = false;
  };

  for (const char of text) {
    const isWordLike = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{Letter}\p{Number}]/u.test(char);
    if (buffer && isWordLike !== bufferIsWord) {
      flush();
    }
    buffer += char;
    bufferIsWord = isWordLike;
  }
  flush();

  return fallback.length ? fallback : [{ surface: text, isWordLike: true }];
}
