export type SourceKind = 'paste' | 'pdf';

export interface DocumentMeta {
  id: string;
  title: string;
  source_kind: SourceKind;
  lang_source: 'ja' | 'en';
  lang_target: 'en';
  size_chars: number;
  size_tokens: number;
  createdAt: number;
  updatedAt: number;
}

export interface Sentence {
  id: string;
  documentId: string;
  index: number;
  text_raw: string;
  text_norm?: string;
  paragraphIndex?: number;
  tokens: Token[];
  translation_en?: string;
  audioSentenceId?: string;
}

export interface Token {
  id: string;
  sentenceId: string;
  index: number;
  surface: string;
  base?: string;
  reading?: string;
  pos?: string;
  pitch?: PitchInfo;
}

export interface PitchInfo {
  pattern: string;
  accents: number[];
}

export interface AudioEntry {
  id: string;
  kind: 'word' | 'sentence';
  provider: string;
  blobRef?: Blob;
  url?: string;
  durationMs: number;
  createdAt: number;
  textHash: string;
}

export interface SrsEntry {
  id: string;
  word_key: string;
  documentId?: string;
  sentenceId?: string;
  fields: {
    target: string;
    reading?: string;
    definition_en?: string;
    audioWordId?: string;
    pitch?: PitchInfo;
    example?: { jp: string; en?: string };
  };
  srs: SrsData;
}

export interface SrsData {
  EF: number;
  interval: number;
  reps: number;
  due: number;
  last: number;
}

export interface Settings {
  id: 'user';
  reader: {
    fontScale: number;
    pageWords: number;
    prefetchPages: number;
    highlightActive: boolean;
    autoPageTurn: boolean;
    showSentenceTranslation: boolean;
  };
  tts: {
    provider: string;
    speed: number;
    stepSec: number;
  };
  translation: {
    provider: string;
    strategy: 'full' | 'windowed';
    pageWords: number;
    prefetchPages: number;
    budgetCents: number | null;
  };
  japanese: {
    furigana: 'hiragana' | 'katakana' | 'romaji' | 'off';
    showPitch: boolean;
    popupFields: string[];
  };
  srs: {
    dailyNew: number;
    dailyReview: number;
    leechThreshold: number;
  };
  accessibility: {
    highContrast: boolean;
    reducedMotion: boolean;
  };
  pwa: {
    offlineMode: boolean;
    maxAudioCacheMB: number;
    maxTranslationCacheMB: number;
  };
}

export interface CacheEntry {
  id: string;
  kind: string;
  key: string;
  value: unknown;
  ttl?: number;
  createdAt: number;
}
