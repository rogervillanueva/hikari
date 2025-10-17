// Comprehensive caching system for translations and TTS
// Reduces API costs by caching everything intelligently

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
}

interface TranslationCache {
  [textHash: string]: CacheEntry<{
    translation: string;
    sourceLanguage: string;
    targetLanguage: string;
  }>;
}

interface TTSCache {
  [textHash: string]: CacheEntry<{
    audioUrl: string;
    audioId: string;
    durationMs: number;
    lang: string;
  }>;
}

interface DocumentCache {
  [documentId: string]: {
    translations: { [pageIndex: number]: string[] };
    vocabulary: Set<string>;
    lastUpdated: number;
  };
}

class SmartCache {
  private translationCache: TranslationCache = {};
  private ttsCache: TTSCache = {};
  private documentCache: DocumentCache = {};
  private maxCacheSize = 10000; // Max entries per cache
  private maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  
  constructor() {
    this.loadFromStorage();
    // Cleanup old entries every hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  // Generate consistent hash for text
  private hash(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // Translation caching
  getTranslation(text: string, direction: string): string | null {
    const key = this.hash(`${text}-${direction}`);
    const entry = this.translationCache[key];
    
    if (entry && this.isValid(entry)) {
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      return entry.data.translation;
    }
    
    return null;
  }

  setTranslation(text: string, translation: string, direction: string): void {
    const key = this.hash(`${text}-${direction}`);
    this.translationCache[key] = {
      data: {
        translation,
        sourceLanguage: direction.split('-')[0],
        targetLanguage: direction.split('-')[1],
      },
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
    };
    
    this.saveToStorage();
  }

  // TTS caching
  getTTS(text: string, lang: string): { audioUrl: string; audioId: string; durationMs: number } | null {
    const key = this.hash(`${text}-${lang}`);
    const entry = this.ttsCache[key];
    
    if (entry && this.isValid(entry)) {
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      return {
        audioUrl: entry.data.audioUrl,
        audioId: entry.data.audioId,
        durationMs: entry.data.durationMs,
      };
    }
    
    return null;
  }

  setTTS(text: string, audioUrl: string, audioId: string, durationMs: number, lang: string): void {
    const key = this.hash(`${text}-${lang}`);
    this.ttsCache[key] = {
      data: { audioUrl, audioId, durationMs, lang },
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
    };
    
    this.saveToStorage();
  }

  // Document-level caching
  getDocumentTranslations(documentId: string, pageIndex: number): string[] | null {
    const doc = this.documentCache[documentId];
    if (doc && doc.translations[pageIndex]) {
      return doc.translations[pageIndex];
    }
    return null;
  }

  setDocumentTranslations(documentId: string, pageIndex: number, translations: string[]): void {
    if (!this.documentCache[documentId]) {
      this.documentCache[documentId] = {
        translations: {},
        vocabulary: new Set(),
        lastUpdated: Date.now(),
      };
    }
    
    this.documentCache[documentId].translations[pageIndex] = translations;
    this.documentCache[documentId].lastUpdated = Date.now();
    this.saveToStorage();
  }

  // Vocabulary tracking for smart pre-loading
  addVocabulary(documentId: string, words: string[]): void {
    if (!this.documentCache[documentId]) {
      this.documentCache[documentId] = {
        translations: {},
        vocabulary: new Set(),
        lastUpdated: Date.now(),
      };
    }
    
    words.forEach(word => this.documentCache[documentId].vocabulary.add(word));
    this.saveToStorage();
  }

  getDocumentVocabulary(documentId: string): string[] {
    const doc = this.documentCache[documentId];
    return doc ? Array.from(doc.vocabulary) : [];
  }

  // Batch operations for efficiency
  getMultipleTranslations(texts: string[], direction: string): { [text: string]: string | null } {
    const results: { [text: string]: string | null } = {};
    texts.forEach(text => {
      results[text] = this.getTranslation(text, direction);
    });
    return results;
  }

  setMultipleTranslations(data: { text: string; translation: string; direction: string }[]): void {
    data.forEach(({ text, translation, direction }) => {
      this.setTranslation(text, translation, direction);
    });
  }

  // Cache management
  private isValid(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp < this.maxAge;
  }

  private cleanup(): void {
    console.log('Running cache cleanup...');
    
    // Clean translation cache
    Object.keys(this.translationCache).forEach(key => {
      if (!this.isValid(this.translationCache[key])) {
        delete this.translationCache[key];
      }
    });

    // Clean TTS cache
    Object.keys(this.ttsCache).forEach(key => {
      if (!this.isValid(this.ttsCache[key])) {
        delete this.ttsCache[key];
      }
    });

    // If cache is too large, remove least accessed items
    this.evictLeastUsed();
    this.saveToStorage();
  }

  private evictLeastUsed(): void {
    // Translation cache eviction
    const translationEntries = Object.entries(this.translationCache);
    if (translationEntries.length > this.maxCacheSize) {
      translationEntries
        .sort(([,a], [,b]) => a.lastAccessed - b.lastAccessed)
        .slice(0, translationEntries.length - this.maxCacheSize)
        .forEach(([key]) => delete this.translationCache[key]);
    }

    // TTS cache eviction
    const ttsEntries = Object.entries(this.ttsCache);
    if (ttsEntries.length > this.maxCacheSize) {
      ttsEntries
        .sort(([,a], [,b]) => a.lastAccessed - b.lastAccessed)
        .slice(0, ttsEntries.length - this.maxCacheSize)
        .forEach(([key]) => delete this.ttsCache[key]);
    }
  }

  // Persistence
  private saveToStorage(): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('hikari-translation-cache', JSON.stringify(this.translationCache));
        localStorage.setItem('hikari-tts-cache', JSON.stringify(this.ttsCache));
        localStorage.setItem('hikari-document-cache', JSON.stringify(
          Object.fromEntries(
            Object.entries(this.documentCache).map(([key, value]) => [
              key,
              { ...value, vocabulary: Array.from(value.vocabulary) }
            ])
          )
        ));
      }
    } catch (error) {
      console.warn('Failed to save cache to localStorage:', error);
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof window !== 'undefined') {
        const translationData = localStorage.getItem('hikari-translation-cache');
        if (translationData) {
          this.translationCache = JSON.parse(translationData);
        }

        const ttsData = localStorage.getItem('hikari-tts-cache');
        if (ttsData) {
          this.ttsCache = JSON.parse(ttsData);
        }

        const documentData = localStorage.getItem('hikari-document-cache');
        if (documentData) {
          const parsed = JSON.parse(documentData);
          this.documentCache = Object.fromEntries(
            Object.entries(parsed).map(([key, value]: [string, any]) => [
              key,
              { ...value, vocabulary: new Set(value.vocabulary) }
            ])
          );
        }
      }
    } catch (error) {
      console.warn('Failed to load cache from localStorage:', error);
    }
  }

  // Stats for monitoring
  getStats() {
    return {
      translations: {
        entries: Object.keys(this.translationCache).length,
        hitRate: this.calculateHitRate(this.translationCache),
      },
      tts: {
        entries: Object.keys(this.ttsCache).length,
        hitRate: this.calculateHitRate(this.ttsCache),
      },
      documents: Object.keys(this.documentCache).length,
    };
  }

  private calculateHitRate(cache: any): number {
    const entries = Object.values(cache) as CacheEntry<any>[];
    if (entries.length === 0) return 0;
    const totalAccess = entries.reduce((sum, entry) => sum + entry.accessCount, 0);
    return totalAccess / entries.length;
  }

  // Generic cache methods for additional data
  get(key: string): string | null {
    try {
      if (typeof window === 'undefined') return null;
      return localStorage.getItem(`hikari-generic-cache:${key}`);
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(`hikari-generic-cache:${key}`, value);
    } catch (error) {
      console.warn('Failed to store in generic cache:', error);
    }
  }

  // Clear cache (for debugging)
  clear(): void {
    this.translationCache = {};
    this.ttsCache = {};
    this.documentCache = {};
    if (typeof window !== 'undefined') {
      localStorage.removeItem('hikari-translation-cache');
      localStorage.removeItem('hikari-tts-cache');
      localStorage.removeItem('hikari-document-cache');
      // Clear generic cache items
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('hikari-generic-cache:')) {
          localStorage.removeItem(key);
        }
      }
    }
  }
}

// Global cache instance
export const smartCache = new SmartCache();
export type { TranslationCache, TTSCache, DocumentCache };