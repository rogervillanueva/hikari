// Pre-loading service to fetch translations and TTS in background
// Reduces API costs by batching and pre-loading content

import { smartCache } from '@/lib/smart-cache';
import { translateSentences } from '@/utils/translateSentences';
import { getTtsProvider } from '@/providers/tts';
import { ACTIVE_TTS_PROVIDER } from '@/lib/config';
import { pageAudioService } from '@/lib/page-audio';
import { SmartPageCache, createTranslationCache } from '@/lib/smart-page-cache';
import type { TranslationDirection } from '@/providers/translation/base';

interface PreloadConfig {
  pagesAhead: number;
  maxBatchSize: number;
  maxConcurrentRequests: number;
  ttsEnabled: boolean;
  vocabularyPreload: boolean;
}

interface DocumentPage {
  documentId: string;
  pageIndex: number;
  content: string;
  sentences: string[];
}

class PreloadService {
  private config: PreloadConfig = {
    pagesAhead: 1, // Changed from 2 to 1 - now loads current + 1 ahead (2 total)
    maxBatchSize: 50,
    maxConcurrentRequests: 3,
    ttsEnabled: true,
    vocabularyPreload: true,
  };

  private activeRequests = new Set<string>();
  private requestQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  
  // Smart caches
  private translationCache: SmartPageCache<any>;

  constructor() {
    // Process queue every 2 seconds
    setInterval(() => this.processQueue(), 2000);
    
    // Initialize smart translation cache
    this.translationCache = createTranslationCache();
  }

  // Main preload function - call when user opens a document
  async preloadDocument(
    documentId: string,
    currentPageIndex: number,
    pages: DocumentPage[],
    direction: TranslationDirection
  ): Promise<void> {
    console.log(`🚀 Starting SMART preload for document ${documentId}, page ${currentPageIndex}`);

    // Use smart prefetching for audio
    if (this.config.ttsEnabled) {
      const audioPages = pages.map(page => ({
        pageIndex: page.pageIndex,
        sentences: page.sentences.map((text, index) => ({
          id: `${page.documentId}_${page.pageIndex}_${index}`,
          documentId: page.documentId,
          index: index,
          text_raw: text,
          tokens: []
        }))
      }));

      await pageAudioService.smartPrefetch(documentId, currentPageIndex, audioPages, pages.length);
    }

    // Use smart caching for translations
    this.translationCache.setCurrentPage(currentPageIndex);
    const translationTargets = this.translationCache.getPrefetchTargets();
    
    console.log(`📚 Smart translation prefetch targets:`, translationTargets);
    
    for (const pageIndex of translationTargets) {
      if (pageIndex >= 0 && pageIndex < pages.length) {
        const page = pages[pageIndex];
        this.queuePagePreload(page, direction);
      }
    }

    // Extract and preload common vocabulary
    if (this.config.vocabularyPreload) {
      this.queueVocabularyPreload(pages, direction);
    }
  }

  // Called when user advances to next page
  async advancePage(
    documentId: string,
    newPageIndex: number,
    pages: DocumentPage[],
    direction: TranslationDirection
  ): Promise<void> {
    console.log(`📖 User advanced to page ${newPageIndex}`);

    // Smart prefetch for audio 
    if (this.config.ttsEnabled) {
      const audioPages = pages.map(page => ({
        pageIndex: page.pageIndex,
        sentences: page.sentences.map((text, index) => ({
          id: `${page.documentId}_${page.pageIndex}_${index}`,
          documentId: page.documentId,
          index: index,
          text_raw: text,
          tokens: []
        }))
      }));

      await pageAudioService.smartPrefetch(documentId, newPageIndex, audioPages, pages.length);
    }

    // Smart prefetch for translations
    this.translationCache.setCurrentPage(newPageIndex);
    const translationTargets = this.translationCache.getPrefetchTargets();
    
    for (const pageIndex of translationTargets) {
      if (pageIndex >= 0 && pageIndex < pages.length) {
        const page = pages[pageIndex];
        
        // Check if already cached
        const cached = this.translationCache.get(pageIndex) || smartCache.getDocumentTranslations(page.documentId, page.pageIndex);
        if (!cached) {
          console.log(`📚 Queueing translation prefetch for page ${pageIndex}`);
          this.queuePagePreload(page, direction);
        }
      }
    }
  }

  // Queue page translation preload
  private queuePagePreload(page: DocumentPage, direction: TranslationDirection): void {
    const requestId = `page-${page.documentId}-${page.pageIndex}`;
    
    if (this.activeRequests.has(requestId)) {
      return; // Already processing
    }

    // Check if already in smart cache
    const smartCached = this.translationCache.get(page.pageIndex);
    if (smartCached) {
      console.log(`✅ Page ${page.pageIndex} already in smart cache`);
      return;
    }

    // Check if already in old cache
    const cached = smartCache.getDocumentTranslations(page.documentId, page.pageIndex);
    if (cached) {
      console.log(`✅ Page ${page.pageIndex} found in old cache, migrating to smart cache`);
      this.translationCache.set(page.pageIndex, cached);
      return;
    }

    this.requestQueue.push(async () => {
      this.activeRequests.add(requestId);
      try {
        // Preload translations
        await this.preloadPageTranslations(page, direction);
        console.log(`✅ Smart preloaded page ${page.pageIndex}`);
      } catch (error) {
        console.error(`❌ Failed to preload page ${page.pageIndex}:`, error);
      } finally {
        this.activeRequests.delete(requestId);
      }
    });
  }

  // Queue vocabulary preload
  private queueVocabularyPreload(pages: DocumentPage[], direction: TranslationDirection): void {
    this.requestQueue.push(async () => {
      try {
        await this.preloadCommonVocabulary(pages, direction);
        console.log('✅ Preloaded common vocabulary');
      } catch (error) {
        console.error('❌ Failed to preload vocabulary:', error);
      }
    });
  }

  // Process request queue with concurrency control
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    const concurrentTasks: Promise<void>[] = [];

    while (
      this.requestQueue.length > 0 && 
      concurrentTasks.length < this.config.maxConcurrentRequests &&
      this.activeRequests.size < this.config.maxConcurrentRequests
    ) {
      const task = this.requestQueue.shift();
      if (task) {
        concurrentTasks.push(task());
      }
    }

    if (concurrentTasks.length > 0) {
      await Promise.allSettled(concurrentTasks);
    }

    this.isProcessingQueue = false;
  }

  // Preload translations for a page
  private async preloadPageTranslations(
    page: DocumentPage,
    direction: TranslationDirection
  ): Promise<void> {
    // Filter sentences that aren't already cached
    const uncachedSentences = page.sentences.filter(sentence => 
      !smartCache.getTranslation(sentence, direction)
    );

    if (uncachedSentences.length === 0) {
      return; // Everything already cached
    }

    console.log(`🔄 Translating ${uncachedSentences.length} uncached sentences for page ${page.pageIndex}`);

    // Batch translate uncached sentences
    const batchedSentences = this.batchSentences(uncachedSentences);
    
    for (const batch of batchedSentences) {
      const sentenceData = batch.map((text, index) => ({
        id: `preload-${page.pageIndex}-${index}`,
        text,
      }));

      try {
        const { translations } = await translateSentences({
          sentences: sentenceData,
          direction,
          documentId: page.documentId,
          batchSize: this.config.maxBatchSize,
          maxCharactersPerBatch: 2000,
          instruction: 'Preload translation for efficient caching.',
        });

        // Cache the results
        Object.entries(translations).forEach(([id, translation]) => {
          const sentenceIndex = parseInt(id.split('-').pop() || '0');
          const originalText = batch[sentenceIndex];
          if (originalText && translation) {
            smartCache.setTranslation(originalText, translation, direction);
          }
        });

        // Cache at document level too
        const allTranslations = batch.map(text => 
          smartCache.getTranslation(text, direction) || ''
        );
        smartCache.setDocumentTranslations(page.documentId, page.pageIndex, allTranslations);
        
        // Also store in smart translation cache
        this.translationCache.set(page.pageIndex, allTranslations);

      } catch (error) {
        console.error('Batch translation failed:', error);
      }
    }

    // Preload TTS for important phrases
    if (this.config.ttsEnabled) {
      await this.preloadPageTTS(page.sentences.slice(0, 10)); // First 10 sentences
    }
  }

  // Preload TTS for common vocabulary
  private async preloadPageTTS(sentences: string[]): Promise<void> {
    const uncachedTTS = sentences.filter(sentence => 
      !smartCache.getTTS(sentence, 'ja')
    );

    // Only preload TTS for shorter phrases (cost control)
    const shortPhrases = uncachedTTS.filter(phrase => phrase.length <= 20);
    
    for (const phrase of shortPhrases.slice(0, 5)) { // Limit to 5 per page
      try {
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: phrase, lang: 'ja' }),
          cache: 'no-store'
        });

        if (response.ok) {
          const { result, url } = await response.json();
          smartCache.setTTS(phrase, url, result.audioId, result.durationMs, 'ja');
        }
      } catch (error) {
        console.error('TTS preload failed for:', phrase, error);
      }
    }
  }

  // Extract and preload common vocabulary
  private async preloadCommonVocabulary(
    pages: DocumentPage[],
    direction: TranslationDirection
  ): Promise<void> {
    // Extract unique words/phrases from all pages
    const allText = pages.map(p => p.content).join(' ');
    const vocabulary = this.extractVocabulary(allText);
    
    // Store vocabulary for this document
    pages.forEach(page => {
      smartCache.addVocabulary(page.documentId, vocabulary);
    });

    // Preload translations for most common words
    const commonWords = vocabulary.slice(0, 100); // Top 100 words
    const uncachedWords = commonWords.filter(word => 
      !smartCache.getTranslation(word, direction)
    );

    if (uncachedWords.length > 0) {
      console.log(`🔤 Preloading ${uncachedWords.length} vocabulary words`);
      
      const batches = this.batchSentences(uncachedWords, 20); // Smaller batches for vocabulary
      
      for (const batch of batches) {
        const sentenceData = batch.map((text, index) => ({
          id: `vocab-${index}`,
          text,
        }));

        try {
          const { translations } = await translateSentences({
            sentences: sentenceData,
            direction,
            documentId: 'vocabulary',
            batchSize: 20,
            maxCharactersPerBatch: 500,
            instruction: 'Translate vocabulary words concisely.',
          });

          // Cache vocabulary translations
          Object.entries(translations).forEach(([id, translation]) => {
            const wordIndex = parseInt(id.split('-').pop() || '0');
            const originalWord = batch[wordIndex];
            if (originalWord && translation) {
              smartCache.setTranslation(originalWord, translation, direction);
            }
          });

        } catch (error) {
          console.error('Vocabulary preload failed:', error);
        }
      }
    }
  }

  // Extract vocabulary from text (simplified Japanese tokenization)
  private extractVocabulary(text: string): string[] {
    // Simple extraction - in practice you'd use kuromoji here
    const words = new Set<string>();
    
    // Extract Japanese phrases (2-10 characters)
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]{2,10}/g;
    const matches = text.match(japaneseRegex) || [];
    
    matches.forEach(match => {
      words.add(match.trim());
      
      // Add substrings for compound words
      if (match.length > 3) {
        for (let i = 0; i < match.length - 1; i++) {
          for (let len = 2; len <= Math.min(6, match.length - i); len++) {
            words.add(match.substring(i, i + len));
          }
        }
      }
    });

    // Convert to array and sort by frequency (simplified)
    return Array.from(words).sort((a, b) => b.length - a.length);
  }

  // Batch sentences for efficient API calls
  private batchSentences(sentences: string[], batchSize = this.config.maxBatchSize): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < sentences.length; i += batchSize) {
      batches.push(sentences.slice(i, i + batchSize));
    }
    return batches;
  }

  // Update configuration
  updateConfig(newConfig: Partial<PreloadConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('📋 Preload config updated:', this.config);
  }

  // Preload page-level audio
  private async preloadPageAudio(page: DocumentPage): Promise<void> {
    try {
      // Convert page sentences to Sentence objects for the audio service
      const sentences = page.sentences.map((text, index) => ({
        id: `${page.documentId}_${page.pageIndex}_${index}`,
        documentId: page.documentId,
        index: index,
        text_raw: text,
        tokens: []
      }));

      await pageAudioService.preloadPageAudio(page.documentId, page.pageIndex, sentences);
      console.log(`🎵 Preloaded page audio for page ${page.pageIndex}`);
    } catch (error) {
      console.warn(`Failed to preload page audio for page ${page.pageIndex}:`, error);
    }
  }

  // Get stats
  getStats() {
    return {
      activeRequests: this.activeRequests.size,
      queuedRequests: this.requestQueue.length,
      config: this.config,
      cacheStats: smartCache.getStats(),
      audioCache: pageAudioService.getCacheStats(),
      translationCache: this.translationCache.getStats(),
    };
  }
}

// Global preload service
export const preloadService = new PreloadService();
export type { PreloadConfig, DocumentPage };