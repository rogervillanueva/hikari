import { createId } from '@/lib/id';
import type { TtsProvider, TtsResult, TtsMark } from './types';

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

function detectEmotionalContext(text: string): string | null {
  const lowerText = text.toLowerCase();
  
  // Enhanced patterns for different emotions/styles in both Japanese and English
  const emotionalPatterns = {
    fearful: /\b(scary|terrifying|frightening|ominous|dark|sinister|menacing|eerie|creepy|haunting|dread|horror|nightmare|ghostly|shadows|lurking|whisper|evil|danger|threat|afraid|fear|panic|scream|恐|怖|暗|影|悪|危険|驚|叫)\b/gi,
    angry: /\b(furious|rage|anger|mad|irritated|frustrated|outraged|livid|enraged|hostile|aggressive|violent|hate|despise|disgusted|怒|腹|憤|激|嫌)\b/gi,
    sad: /\b(sad|sorrow|grief|mourning|melancholy|depressed|heartbroken|tragic|devastating|loss|death|goodbye|farewell|tears|crying|lonely|empty|悲|寂|涙|泣|死|別)\b/gi,
    cheerful: /\b(happy|joy|excited|wonderful|amazing|fantastic|great|excellent|delighted|thrilled|celebration|party|laugh|smile|cheerful|bright|sunny|嬉|楽|喜|笑|明|幸)\b/gi,
    whispering: /\b(whisper|quietly|softly|secretly|confidentially|hushed|murmur|breathe|intimate|囁|静|密|秘)\b/gi,
    hopeful: /\b(hope|optimistic|bright|future|dreams|aspiration|potential|possibility|opportunity|tomorrow|better|improve|success|achievement|希望|夢|未来|可能|成功|明日)\b/gi
  };
  
  // Count matches for each emotion
  const emotionScores: { [key: string]: number } = {};
  
  for (const [emotion, pattern] of Object.entries(emotionalPatterns)) {
    const matches = lowerText.match(pattern);
    emotionScores[emotion] = matches ? matches.length : 0;
  }
  
  // Find the emotion with the highest score
  let maxEmotion: string | null = null;
  let maxScore = 0;
  
  for (const [emotion, score] of Object.entries(emotionScores)) {
    if (score > maxScore) {
      maxEmotion = emotion;
      maxScore = score;
    }
  }
  
  // Enhanced detection: lower threshold for stronger emotional impact
  const strongIndicators = ['terrifying', 'nightmare', 'furious', 'devastated', 'whisper', '恐怖', '悪夢', '激怒', '囁く'];
  const hasStrongIndicator = strongIndicators.some(indicator => lowerText.includes(indicator));
  
  if (maxScore >= 1 || hasStrongIndicator) {
    console.log(`[Azure TTS] Detected emotion: ${maxEmotion} (score: ${maxScore})`);
    return maxEmotion;
  }
  
  return null;
}

function wrapWithEmotionalStyle(text: string, voice: string, emotion: string): string {
  // Enhanced voice support - more voices can handle emotional styles
  const emotionalVoices = [
    'en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-GuyNeural', 
    'en-US-DavisNeural', 'en-US-AmberNeural', 'en-US-AnaNeural',
    'ja-JP-MayuNeural', 'ja-JP-AoiNeural', 'ja-JP-ShioriNeural'
  ];
  
  if (!emotionalVoices.includes(voice)) {
    console.log(`[Azure TTS] Voice ${voice} doesn't support emotional styles, using default`);
    return text; // Voice doesn't support emotional styles
  }
  
  // Map emotions to Azure's express-as styles
  const emotionMapping: { [key: string]: string } = {
    fearful: 'terrified',
    angry: 'angry', 
    sad: 'sad',
    cheerful: 'cheerful',
    whispering: 'whispering',
    hopeful: 'hopeful'
  };
  
  const azureStyle = emotionMapping[emotion] || emotion;
  console.log(`[Azure TTS] Applying emotional style: ${azureStyle} to voice: ${voice}`);
  
  // Wrap text with appropriate mstts:express-as tag
  return `<mstts:express-as style="${azureStyle}">${text}</mstts:express-as>`;
}

function resolveVoice(voiceId: string | undefined, lang: 'ja' | 'en') {
  if (voiceId?.trim()) return voiceId.trim();
  if (process.env.AZURE_TTS_VOICE?.trim()) return process.env.AZURE_TTS_VOICE.trim();
  if (process.env.NEXT_PUBLIC_TTS_VOICE?.trim()) return process.env.NEXT_PUBLIC_TTS_VOICE.trim();
  // Using highly expressive neural voices with emotional range
  if (lang === 'ja') return 'ja-JP-MayuNeural';
  return 'en-US-AriaNeural';
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

function estimateMarkTimings(expectedMarks: string[], totalDurationMs: number, text: string): TtsMark[] {
  const marks: TtsMark[] = [];
  
  // Add basic start mark
  marks.push({ offsetMs: 0, tag: 'start' });
  
  console.log('[Azure TTS] Estimating timing for', expectedMarks.length, 'marks in', totalDurationMs, 'ms');
  
  // For sentence marks, estimate timing based on position in text and speech patterns
  const sentenceMarks = expectedMarks.filter(mark => mark.includes('sentence_'));
  
  if (sentenceMarks.length > 0) {
    // Extract text content by finding text between markers
    const textWithoutMarks = text.replace(/<[^>]+>/g, '');
    const totalChars = textWithoutMarks.length;
    
    // Account for breaks in the total duration
    const breakMatches = text.match(/<break[^>]*time="(\d+)ms"[^>]*>/g);
    const totalBreakTime = breakMatches ? breakMatches.reduce((sum, match) => {
      const timeMatch = match.match(/time="(\d+)ms"/);
      return sum + (timeMatch ? parseInt(timeMatch[1]) : 0);
    }, 0) : 0;
    
    // Available time for actual speech (excluding breaks)
    const speechDurationMs = Math.max(500, totalDurationMs - totalBreakTime);
    
    console.log('[Azure TTS] Speech timing analysis:', {
      totalDurationMs,
      totalBreakTime,
      speechDurationMs,
      totalChars,
      msPerChar: speechDurationMs / totalChars
    });
    
    // Find positions of sentence markers in the original text
    let currentTextPos = 0;
    let currentTimeMs = 0;
    
    for (const mark of sentenceMarks) {
      // Find the mark in the original text
      const markPattern = new RegExp(`<mark name="${mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
      const textToSearch = text.slice(currentTextPos);
      const match = textToSearch.match(markPattern);
      
      if (match && match.index !== undefined) {
        const markPosInText = currentTextPos + match.index;
        
        // Count actual text characters (excluding tags) up to this mark
        const textBeforeMark = text.slice(0, markPosInText);
        const charsBeforeMark = textBeforeMark.replace(/<[^>]+>/g, '').length;
        
        // Count breaks before this mark
        const breaksBeforeMark = (textBeforeMark.match(/<break[^>]*time="(\d+)ms"[^>]*>/g) || [])
          .reduce((sum, breakMatch) => {
            const timeMatch = breakMatch.match(/time="(\d+)ms"/);
            return sum + (timeMatch ? parseInt(timeMatch[1]) : 0);
          }, 0);
        
        // Calculate time: speech time based on character ratio + break time
        const speechProgressRatio = totalChars > 0 ? charsBeforeMark / totalChars : 0;
        const speechTimeMs = speechDurationMs * speechProgressRatio;
        const estimatedTimeMs = Math.round(speechTimeMs + breaksBeforeMark);
        
        console.log('[Azure TTS] Mark timing:', {
          mark,
          charsBeforeMark,
          totalChars,
          speechProgressRatio,
          speechTimeMs,
          breaksBeforeMark,
          estimatedTimeMs
        });
        
        marks.push({
          offsetMs: Math.max(currentTimeMs, estimatedTimeMs),
          tag: mark
        });
        
        currentTextPos = markPosInText + match[0].length;
        currentTimeMs = Math.max(currentTimeMs, estimatedTimeMs);
      }
    }
  }
  
  // Add basic end mark
  marks.push({ offsetMs: totalDurationMs, tag: 'end' });
  
  console.log('[Azure TTS] Generated timing marks:', marks.map(m => ({ tag: m.tag, time: m.offsetMs })));
  
  return marks;
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

  // Handle SSML with marks and emotional context detection
  let ssml: string;
  let expectedMarks: string[] = [];
  
  if (text.includes('<mark') || text.includes('<break')) {
    // Text already contains SSML marks, use as-is but check for emotional context
    let processedText = text;
    
    // Detect emotional context from the text content (excluding SSML tags)
    const textContent = text.replace(/<[^>]+>/g, '');
    const emotion = detectEmotionalContext(textContent);
    if (emotion) {
      processedText = wrapWithEmotionalStyle(text, voice, emotion);
    }
    
    ssml = `<?xml version="1.0" encoding="utf-8"?>\n<speak version="1.0" xml:lang="${locale}" xmlns:mstts="https://www.w3.org/2001/mstts"><voice name="${voice}">${processedText}</voice></speak>`;
    
    // Extract mark names for timing tracking
    const markMatches = text.match(/<mark name="([^"]+)"/g);
    if (markMatches) {
      expectedMarks = markMatches.map(match => {
        const nameMatch = match.match(/name="([^"]+)"/);
        return nameMatch ? nameMatch[1] : '';
      }).filter(Boolean);
    }
  } else {
    // Plain text, escape it and check for emotional context
    let processedText = escapeSsml(text);
    
    // Detect emotional context
    const emotion = detectEmotionalContext(text);
    if (emotion) {
      processedText = wrapWithEmotionalStyle(processedText, voice, emotion);
    }
    
    ssml = `<?xml version="1.0" encoding="utf-8"?>\n<speak version="1.0" xml:lang="${locale}" xmlns:mstts="https://www.w3.org/2001/mstts"><voice name="${voice}">${processedText}</voice></speak>`;
  }

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

  // If we have expected marks but no timing info from Azure, estimate timing
  let marks: TtsResult['marks'];
  if (expectedMarks.length > 0) {
    marks = estimateMarkTimings(expectedMarks, durationMs, text);
  } else {
    marks = [
      { offsetMs: 0, tag: 'start' },
      { offsetMs: durationMs, tag: 'end' }
    ];
  }

  console.info('[tts:azure] generated audio', {
    voice,
    locale,
    chars: text.length,
    durationMs,
    marksCount: marks?.length || 0
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
