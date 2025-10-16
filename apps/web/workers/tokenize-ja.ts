import { segmentWithHeuristics, segmentWithIntl } from '@/lib/morphology/fallback';
import { buildDiagnosticLog, serializeError } from '@/lib/morphology/diagnostics';
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
  log?: string;
  timestamp?: string;
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

const REMOTE_FAILURE_BACKOFFS_MS = [5_000, 15_000, 60_000, 300_000];
let remoteUnavailableUntil = 0;
let consecutiveRemoteFailures = 0;

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
  if (remoteUnavailableUntil > Date.now()) {
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
      let details: { error?: string; help?: string[]; context?: unknown } | null = null;
      try {
        details = (await response.json()) as {
          error?: string;
          help?: string[];
          context?: unknown;
        } | null;
      } catch (error) {
        // Ignore body parsing errors and fall back to a generic message.
      }
      const message = details?.error ?? `Remote tokenizer returned status ${response.status}.`;
      recordRemoteFailure(message, details?.help, {
        level: 'error',
        source: 'remote',
        context: {
          status: response.status,
          endpoint: MORPHOLOGY_ENDPOINT ?? '(not set)',
          response: details,
        },
      });
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
      recordRemoteFailure(
        'Remote tokenizer did not return any tokens. Falling back to heuristics.',
        undefined,
        {
          source: payload?.source ?? 'remote',
          context: {
            endpoint: MORPHOLOGY_ENDPOINT ?? '(not set)',
            receivedTokenCount: payload?.tokens?.length ?? 0,
            diagnostics: payload?.diagnostics ?? [],
          },
        },
      );
      return null;
    }

    if (looksLikePerCharacterSegmentation(payload.tokens, text)) {
      console.warn('[tokenize-ja] remote tokenizer returned low-quality segmentation, falling back');
      recordRemoteFailure(
        'Remote tokenizer returned low-quality segmentation. Falling back to heuristics.',
        [...(payload?.diagnostics?.flatMap((diagnostic) => diagnostic.help ?? []) ?? [])],
        {
          source: payload?.source ?? 'remote',
          context: {
            endpoint: MORPHOLOGY_ENDPOINT ?? '(not set)',
            tokenCount: payload.tokens.length,
            tokenPreview: payload.tokens.slice(0, 12).map((token) => token.surface).join(' '),
          },
        },
      );
      return null;
    }

    consecutiveRemoteFailures = 0;
    remoteUnavailableUntil = 0;

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
    recordRemoteFailure(
      'Failed to reach remote tokenizer. Falling back to heuristics.',
      [error instanceof Error ? error.message : String(error)],
      {
        level: 'error',
        source: 'remote',
        context: {
          endpoint: MORPHOLOGY_ENDPOINT ?? '(not set)',
          error: serializeError(error),
        },
      },
    );
    return null;
  }
}

function recordRemoteFailure(
  message: string,
  help?: string[],
  options?: {
    level?: MorphologyDiagnostic['level'];
    source?: string;
    context?: Record<string, unknown>;
  },
) {
  const nextFailureCount = Math.min(consecutiveRemoteFailures + 1, REMOTE_FAILURE_BACKOFFS_MS.length);
  const backoffIndex = Math.min(nextFailureCount - 1, REMOTE_FAILURE_BACKOFFS_MS.length - 1);
  const delay = REMOTE_FAILURE_BACKOFFS_MS[backoffIndex] ?? REMOTE_FAILURE_BACKOFFS_MS[0];
  const now = Date.now();
  remoteUnavailableUntil = now + delay;
  consecutiveRemoteFailures = nextFailureCount;
  const seconds = Math.max(1, Math.round(delay / 1000));
  const helpMessages = [...(help ?? []), `Retrying remote tokenizer in ${seconds} seconds.`].filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
  const timestamp = new Date(now).toISOString();
  const log = buildDiagnosticLog({
    message,
    help: helpMessages,
    source: options?.source ?? 'remote',
    timestamp,
    details: {
      failureCount: nextFailureCount,
      backoffMs: delay,
      nextRetryAt: new Date(remoteUnavailableUntil).toISOString(),
      ...(options?.context ?? {}),
    },
  });
  emitMorphologyDiagnostic({
    level: options?.level ?? 'warning',
    message,
    help: helpMessages,
    source: options?.source,
    log,
    timestamp,
  });
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
