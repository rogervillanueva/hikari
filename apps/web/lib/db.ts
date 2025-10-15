'use client';

import Dexie, { Table } from 'dexie';
import type {
  AudioEntry,
  CacheEntry,
  DocumentMeta,
  Sentence,
  Settings,
  SrsEntry
} from './types';

class HikariDatabase extends Dexie {
  documents!: Table<DocumentMeta, string>;
  sentences!: Table<Sentence, string>;
  audio!: Table<AudioEntry, string>;
  settings!: Table<Settings, string>;
  srs_entries!: Table<SrsEntry, string>;
  caches!: Table<CacheEntry, string>;

  constructor() {
    super('hikari');
    this.version(1).stores({
      documents: '&id, title, createdAt, updatedAt',
      sentences: '&id, documentId, index',
      audio: '&id, provider, kind, textHash',
      settings: '&id',
      srs_entries: '&id, due, word_key',
      caches: '&id, kind, key, createdAt'
    });
  }
}

export const db = new HikariDatabase();

export async function getOrCreateSettings(): Promise<Settings> {
  const existing = await db.settings.get('user');
  if (existing) return existing;
  const defaults: Settings = {
    id: 'user',
    reader: {
      fontScale: 1,
      pageWords: 500,
      prefetchPages: 3,
      highlightActive: true,
      autoPageTurn: true,
      showSentenceTranslation: false
    },
    tts: {
      provider: 'mock',
      speed: 1,
      stepSec: 5
    },
    translation: {
      provider: 'mock',
      strategy: 'windowed',
      pageWords: 500,
      prefetchPages: 3,
      budgetCents: null
    },
    japanese: {
      furigana: 'hiragana',
      showPitch: false,
      popupFields: ['definition', 'reading', 'pitch', 'audio', 'example']
    },
    srs: {
      dailyNew: 10,
      dailyReview: 100,
      leechThreshold: 8
    },
    accessibility: {
      highContrast: false,
      reducedMotion: false
    },
    pwa: {
      offlineMode: true,
      maxAudioCacheMB: 200,
      maxTranslationCacheMB: 50
    }
  };
  await db.settings.put(defaults);
  return defaults;
}
