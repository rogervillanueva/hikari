import { createId } from '@/lib/id';
import type { TtsProvider, TtsResult } from './types';

const DEFAULT_SAMPLE_RATE = 16000;
const PCM_HEADER_BYTES = 44;
const PRICE_CENTS_PER_CHAR = 0.0016; // $16 per 1M characters
const budgetEnv = Number(process.env.AZURE_TTS_BUDGET_CENTS ?? '100');
const DEFAULT_BUDGET_CENTS = Number.isFinite(budgetEnv) ? budgetEnv : 100;
const CLIENT_AUDIO_CACHE = new Map<string, string>();

type UsageTracker = {
  date: string;
  chars: number;
  costCents: number;
};

type GlobalWithAzure = typeof globalThis & {
  __azureTtsUsage?: UsageTracker;
  __azureTtsServerCache?: Map<string, string>;
};

const globalAzure = globalThis as GlobalWithAzure;

if (!globalAzure.__azureTtsServerCache) {
  globalAzure.__azureTtsServerCache = new Map<string, string>();
}

const SERVER_AUDIO_CACHE = globalAzure.__azureTtsServerCache;

function escapeSsml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveVoice(voiceId: string | undefined, lang: 'ja' | 'en') {
  if (voiceId?.trim()) return voiceId.trim();
  if (process.env.AZURE_TTS_VOICE?.trim()) return process.env.AZURE_TTS_VOICE.trim();
  if (process.env.NEXT_PUBLIC_TTS_VOICE?.trim()) return process.env.NEXT_PUBLIC_TTS_VOICE.trim();
  if (lang === 'ja') return 'ja-JP-NanamiNeural';
  return 'en-US-JennyNeural';
}

function resolveLocaleFromVoice(voice: string) {
  const parts = voice.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return 'ja-JP';
}

function getUsageTracker(): UsageTracker {
  const today = new Date().toISOString().slice(0, 10);
  const usage = globalAzure.__azureTtsUsage;
  if (!usage || usage.date !== today) {
    const fresh: UsageTracker = {
      date: today,
      chars: 0,
      costCents: 0
    };
    globalAzure.__azureTtsUsage = fresh;
    return fresh;
  }
  return usage;
}

function registerUsage(chars: number) {
  const tracker = getUsageTracker();
  const additionalCost = chars * PRICE_CENTS_PER_CHAR;
  if (DEFAULT_BUDGET_CENTS > 0 && tracker.costCents + additionalCost > DEFAULT_BUDGET_CENTS) {
    throw new Error(
      `Azure TTS daily budget exceeded. Limit: $${(DEFAULT_BUDGET_CENTS / 100).toFixed(2)}.`
    );
  }
  tracker.chars += chars;
  tracker.costCents += additionalCost;
  globalAzure.__azureTtsUsage = tracker;
}

async function speakSentenceServer(
  text: string,
  lang: 'ja' | 'en',
  voiceId?: string
): Promise<TtsResult> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  const endpoint =
    process.env.AZURE_SPEECH_ENDPOINT ?? `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  if (!key || !region) {
    throw new Error('Azure Speech key and region must be set to use the Azure TTS provider.');
  }

  const voice = resolveVoice(voiceId, lang);
  const locale = resolveLocaleFromVoice(voice);

  registerUsage(text.length);

  const ssml = `<?xml version="1.0" encoding="utf-8"?>\n<speak version="1.0" xml:lang="${locale}"><voice name="${voice}">${escapeSsml(
    text
  )}</voice></speak>`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'riff-16khz-16bit-mono-pcm',
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
      'User-Agent': 'HikariReader/1.0'
    },
    body: ssml,
    cache: 'no-store'
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Azure TTS request failed: ${response.status} ${response.statusText} - ${message}`);
  }

  const buffer = await response.arrayBuffer();
  const audioId = createId('audio');
  const base64 = Buffer.from(buffer).toString('base64');
  const dataUrl = `data:audio/wav;base64,${base64}`;
  SERVER_AUDIO_CACHE.set(audioId, dataUrl);

  const pcmBytes = Math.max(0, buffer.byteLength - PCM_HEADER_BYTES);
  const durationMs = Math.max(500, Math.round((pcmBytes / (DEFAULT_SAMPLE_RATE * 2)) * 1000));

  const marks: TtsResult['marks'] = [
    { offsetMs: 0, tag: 'start' },
    { offsetMs: durationMs, tag: 'end' }
  ];

  console.info('[tts:azure] generated audio', {
    voice,
    locale,
    chars: text.length,
    durationMs
  });

  return {
    audioId,
    durationMs,
    marks
  };
}

function getServerAudioUrl(audioId: string) {
  const url = SERVER_AUDIO_CACHE.get(audioId);
  if (!url) {
    throw new Error(`Azure audio ${audioId} not found on server cache.`);
  }
  return url;
}

async function speakSentenceClient(text: string, lang: 'ja' | 'en', voiceId?: string) {
  const voice = resolveVoice(voiceId, lang);
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang, voiceId: voice }),
    cache: 'no-store'
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Azure TTS client request failed: ${response.status} ${response.statusText} - ${message}`);
  }

  const payload = (await response.json()) as { result: TtsResult; url: string };
  CLIENT_AUDIO_CACHE.set(payload.result.audioId, payload.url);
  return payload.result;
}

function getClientAudioUrl(audioId: string) {
  const url = CLIENT_AUDIO_CACHE.get(audioId);
  if (!url) {
    throw new Error(`Azure audio ${audioId} not found in client cache.`);
  }
  return url;
}

export const azureTtsProvider: TtsProvider = {
  id: 'azure',
  label: 'Azure Cognitive Services TTS',
  async speakSentence(text, lang, voiceId) {
    if (typeof window === 'undefined') {
      return speakSentenceServer(text, lang, voiceId);
    }
    return speakSentenceClient(text, lang, voiceId);
  },
  async getAudioUrl(audioId) {
    if (typeof window === 'undefined') {
      return getServerAudioUrl(audioId);
    }
    return getClientAudioUrl(audioId);
  }
};
