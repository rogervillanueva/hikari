import { getTtsProvider } from '@/providers/tts';
import { ACTIVE_TTS_PROVIDER } from '@/lib/config';
import { smartCache } from '@/lib/smart-cache';
import { SmartPageCache, createAudioCache } from '@/lib/smart-page-cache';
import type { Sentence } from '@/lib/types';
import type { TtsMark } from '@/providers/tts/types';

export interface SentenceTimestamp {
  sentenceIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  audioUrl?: string; // Individual sentence audio URL for perfect playback
  audioId?: string;  // Individual sentence audio ID
  durationMs?: number; // Actual duration from TTS
}

export interface PageAudio {
  audioId: string;
  audioUrl: string;
  totalDurationMs: number;
  sentenceTimestamps: SentenceTimestamp[];
}

export class PageAudioService {
  private static instance: PageAudioService;
  private cache = new Map<string, PageAudio>();
  private loadingPromises = new Map<string, Promise<PageAudio>>();
  private documentCaches = new Map<string, SmartPageCache<PageAudio>>();  // Document-specific caches

  constructor() {
    // Constructor no longer creates a single global cache
  }

  private getDocumentCache(documentId: string): SmartPageCache<PageAudio> {
    if (!this.documentCaches.has(documentId)) {
      console.log(`[PageAudioService] 🆕 Creating new cache for document ${documentId}`);
      this.documentCaches.set(documentId, createAudioCache());
    }
    return this.documentCaches.get(documentId)!;
  }

  static getInstance(): PageAudioService {
    if (!PageAudioService.instance) {
      PageAudioService.instance = new PageAudioService();
    }
    return PageAudioService.instance;
  }

  private generatePageKey(documentId: string, pageIndex: number): string {
    return `${documentId}:${pageIndex}`;
  }

  private buildPageTextWithMarkers(sentences: Sentence[]): string {
    const voice = process.env.NEXT_PUBLIC_TTS_VOICE || 'ja-JP-MayuNeural';
    
    let ssmlText = `<speak version="1.0" xml:lang="ja-JP" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts">
<voice name="${voice}">`;

    sentences.forEach((sentence, index) => {
      // Add substantial pause before each sentence (except first) to create clear boundaries
      if (index > 0) {
        ssmlText += `<break time="400ms"/>`;
      }
      
      // Add sentence start marker immediately before text
      ssmlText += `<mark name="sentence-${index}"/>`;
      
      // Add the sentence text  
      ssmlText += sentence.text_raw;
      
      // Add sentence end marker immediately after text
      ssmlText += `<mark name="sentence-${index}-end"/>`;
      
      // Add pause after sentence to ensure clear separation
      if (index < sentences.length - 1) {
        ssmlText += `<break time="300ms"/>`;
      }
    });

    ssmlText += `</voice></speak>`;
    
    console.log('[PageAudioService] Generated SSML with enhanced breaks:', {
      sentenceCount: sentences.length,
      totalBreaks: (sentences.length - 1) * 2, // Before + after breaks
      ssmlPreview: ssmlText.substring(0, 200) + '...'
    });
    
    return ssmlText;
  }

  private parseSentenceTimestamps(sentences: Sentence[], marks: TtsMark[]): SentenceTimestamp[] {
    const timestamps: SentenceTimestamp[] = [];
    
    console.log('[PageAudioService] Parsing timestamps from', marks.length, 'TTS markers');
    console.log('[PageAudioService] Available markers:', marks.map(m => ({ tag: m.tag, offset: m.offsetMs })));
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const startMark = marks.find(mark => mark.tag === `sentence_${i}_start`);
      const endMark = marks.find(mark => mark.tag === `sentence_${i}_end`);
      
      if (startMark && endMark) {
        const timestamp = {
          sentenceIndex: i, // Use page-relative index (array index)
          startTimeMs: startMark.offsetMs,
          endTimeMs: endMark.offsetMs,
          text: sentence.text_raw
        };
        
        console.log('[PageAudioService] Parsed marker timing for sentence', i, ':', {
          index: sentence.index,
          start: startMark.offsetMs,
          end: endMark.offsetMs,
          duration: endMark.offsetMs - startMark.offsetMs,
          text: sentence.text_raw.substring(0, 30) + '...'
        });
        
        timestamps.push(timestamp);
      } else {
        console.warn('[PageAudioService] Missing markers for sentence', i, '- falling back to estimation');
        
        // Fallback: estimate timing based on character count
        const previousEnd = timestamps[i - 1]?.endTimeMs || 0;
        const estimatedDuration = sentence.text_raw.length * 100; // ~100ms per character
        
        timestamps.push({
          sentenceIndex: i, // Use page-relative index (array index)
          startTimeMs: previousEnd,
          endTimeMs: previousEnd + estimatedDuration,
          text: sentence.text_raw
        });
      }
    }

    console.log('[PageAudioService] Final parsed timestamps:', timestamps.length, 'entries');
    return timestamps;
  }

  async getPageAudio(documentId: string, pageIndex: number, sentences: Sentence[]): Promise<PageAudio> {
    const pageKey = this.generatePageKey(documentId, pageIndex);
    const documentCache = this.getDocumentCache(documentId);
    
    // Update smart cache with current page
    documentCache.setCurrentPage(pageIndex);
    
    // Check smart page cache first
    const cachedPageAudio = documentCache.get(pageIndex);
    if (cachedPageAudio) {
      console.log(`[PageAudioService] 🎯 Smart cache HIT for document ${documentId} page ${pageIndex}`);
      return cachedPageAudio;
    }

    // Return existing loading promise if in progress
    if (this.loadingPromises.has(pageKey)) {
      console.log(`[PageAudioService] ⏳ Returning existing loading promise for page ${pageIndex}`);
      return this.loadingPromises.get(pageKey)!;
    }

    // Check old smart cache as fallback
    const cacheKey = `page_audio:${pageKey}`;
    const oldCachedPageAudio = smartCache.get(cacheKey);
    if (oldCachedPageAudio) {
      const pageAudio = JSON.parse(oldCachedPageAudio) as PageAudio;
      console.log(`[PageAudioService] 📦 Found in old cache, migrating to smart cache for document ${documentId} page ${pageIndex}`);
      documentCache.set(pageIndex, pageAudio);
      return pageAudio;
    }

    // Generate new page audio
    console.log(`[PageAudioService] 🚀 Generating NEW audio for document ${documentId} page ${pageIndex}`);
    const loadingPromise = this.generatePageAudio(documentId, pageIndex, sentences);
    this.loadingPromises.set(pageKey, loadingPromise);

    try {
      const pageAudio = await loadingPromise;
      
      // Store in smart cache
      documentCache.set(pageIndex, pageAudio);
      
      // Also store in old cache for compatibility
      smartCache.set(cacheKey, JSON.stringify(pageAudio));
      
      console.log(`[PageAudioService] ✅ Generated and cached document ${documentId} page ${pageIndex}:`, documentCache.getStats());
      
      return pageAudio;
    } finally {
      this.loadingPromises.delete(pageKey);
    }
  }

  private async generatePageAudio(documentId: string, pageIndex: number, sentences: Sentence[]): Promise<PageAudio> {
    if (sentences.length === 0) {
      throw new Error('No sentences to generate audio for');
    }

    console.log('[PageAudioService] 🎯 Generating SENTENCE-LEVEL audio for page', pageIndex, 'with', sentences.length, 'sentences');
    console.log('[PageAudioService] Document sentence indexes:', sentences.map(s => s.index));
    console.log('[PageAudioService] Index range:', Math.min(...sentences.map(s => s.index)), 'to', Math.max(...sentences.map(s => s.index)));

    const provider = getTtsProvider(ACTIVE_TTS_PROVIDER);
    console.log('[PageAudioService] Using TTS provider:', provider.id);
    
    try {
      // Generate individual audio for each sentence in parallel
      console.log('[PageAudioService] 🚀 Starting parallel sentence generation...');
      
      const sentenceAudioPromises = sentences.map(async (sentence, index) => {
        console.log(`[PageAudioService] 🎤 Generating audio for sentence ${sentence.index}: "${sentence.text_raw.substring(0, 50)}..."`);
        
        const result = await provider.speakSentence(sentence.text_raw, 'ja');
        const audioUrl = await provider.getAudioUrl(result.audioId);
        
        console.log(`[PageAudioService] ✅ Generated sentence ${sentence.index}: ${result.durationMs}ms`);
        
        return {
          sentence,
          audioId: result.audioId,
          audioUrl,
          durationMs: result.durationMs,
          index
        };
      });

      // Wait for all sentences to complete
      const sentenceAudios = await Promise.all(sentenceAudioPromises);
      console.log('[PageAudioService] 🎉 All sentences generated successfully');

      // Create precise sentence timestamps with perfect accuracy
      const sentenceTimestamps: SentenceTimestamp[] = [];
      let currentTimeMs = 0;
      const pauseBetweenSentences = 100; // 100ms pause between sentences (match concatenation)

      for (let i = 0; i < sentenceAudios.length; i++) {
        const sentenceAudio = sentenceAudios[i];
        const startTimeMs = currentTimeMs;
        const endTimeMs = currentTimeMs + sentenceAudio.durationMs;
        
        sentenceTimestamps.push({
          sentenceIndex: i, // Use page-relative index instead of global index
          startTimeMs,
          endTimeMs,
          text: sentenceAudio.sentence.text_raw,
          audioUrl: sentenceAudio.audioUrl,  // Store individual audio URL
          audioId: sentenceAudio.audioId,    // Store individual audio ID
          durationMs: sentenceAudio.durationMs // Store actual duration
        });

        console.log(`[PageAudioService] 🎯 PERFECT timestamp for sentence ${i} (global: ${sentenceAudio.sentence.index}):`, {
          startTimeMs,
          endTimeMs,
          actualDurationMs: sentenceAudio.durationMs,
          hasAudioUrl: !!sentenceAudio.audioUrl,
          text: sentenceAudio.sentence.text_raw.substring(0, 40) + '...'
        });

        // Move to next sentence with pause
        currentTimeMs = endTimeMs + pauseBetweenSentences;
      }

      // Concatenate all audio files into a single seamless audio
      console.log('[PageAudioService] 🔗 Concatenating individual audio files into unified page audio...');
      
      // Prepare audio buffers for concatenation
      const audioBuffers = await Promise.all(sentenceAudios.map(async (sa) => {
        const response = await fetch(sa.audioUrl);
        const audioBuffer = await response.arrayBuffer();
        return { audioBuffer, durationMs: sa.durationMs };
      }));
      
      const concatenatedAudio = await this.concatenateAudioFiles(audioBuffers);
      
      const totalDurationMs = currentTimeMs - pauseBetweenSentences; // Remove last pause

      const pageAudio: PageAudio = {
        audioId: `page_${documentId}_${pageIndex}_${Date.now()}`,
        audioUrl: concatenatedAudio.audioUrl,
        totalDurationMs: concatenatedAudio.totalDurationMs,
        sentenceTimestamps
      };

      console.log('[PageAudioService] 🎯 Generated PERFECT sentence-level page audio:', {
        mode: 'UNIFIED_CONCATENATED',
        totalDurationMs: Math.round(pageAudio.totalDurationMs),
        timestampsCount: sentenceTimestamps.length,
        sentenceIndexes: sentenceTimestamps.map(t => t.sentenceIndex),
        individualDurations: sentenceAudios.map(sa => sa.durationMs),
        allSentencesHaveAudio: sentenceTimestamps.every(t => !!t.audioUrl),
        concatenatedAudioSize: concatenatedAudio.audioUrl.length,
        pauseBetweenSentences
      });

      return pageAudio;
    } catch (error) {
      console.error('Failed to generate sentence-level page audio:', error);
      
      // Fallback: use the old estimation approach
      console.log('[PageAudioService] 🔄 Falling back to estimation approach...');
      return this.generateFallbackPageAudio(sentences);
    }
  }

  /**
   * Concatenate individual sentence audio files into a single seamless page audio
   */
  private async concatenateAudioFiles(sentenceAudios: { audioBuffer: ArrayBuffer, durationMs: number }[]): Promise<{ audioUrl: string, totalDurationMs: number }> {
    console.log('[PageAudioService] 🔗 Starting audio concatenation for', sentenceAudios.length, 'sentences');
    
    try {
      // Use Web Audio API for concatenation
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const concatenatedBuffers: Float32Array[] = [];
      let totalSamples = 0;
      let sampleRate = 0;

      // Decode all audio buffers
      for (let i = 0; i < sentenceAudios.length; i++) {
        const { audioBuffer, durationMs } = sentenceAudios[i];
        console.log(`[PageAudioService] 🎵 Decoding sentence ${i + 1} audio (${durationMs}ms)`);
        
        const decodedBuffer = await audioContext.decodeAudioData(audioBuffer.slice(0));
        sampleRate = decodedBuffer.sampleRate;
        
        // Get the audio data (assuming mono or taking left channel)
        const audioData = decodedBuffer.getChannelData(0);
        concatenatedBuffers.push(audioData);
        totalSamples += audioData.length;
        
        // Add pause between sentences (100ms)
        if (i < sentenceAudios.length - 1) {
          const pauseSamples = Math.floor(sampleRate * 0.1); // 100ms pause
          const pauseData = new Float32Array(pauseSamples);
          concatenatedBuffers.push(pauseData);
          totalSamples += pauseSamples;
        }
      }

      // Create the final concatenated buffer
      console.log('[PageAudioService] 🎼 Creating final audio buffer with', totalSamples, 'samples at', sampleRate, 'Hz');
      const finalBuffer = audioContext.createBuffer(1, totalSamples, sampleRate);
      const finalData = finalBuffer.getChannelData(0);
      
      let offset = 0;
      for (const bufferData of concatenatedBuffers) {
        finalData.set(bufferData, offset);
        offset += bufferData.length;
      }

      // Convert to WAV blob
      const wavBlob = this.audioBufferToWav(finalBuffer);
      const audioUrl = URL.createObjectURL(wavBlob);
      const totalDurationMs = (totalSamples / sampleRate) * 1000;

      console.log('[PageAudioService] ✅ Audio concatenation complete:', {
        totalDurationMs: Math.round(totalDurationMs),
        fileSize: `${Math.round(wavBlob.size / 1024)}KB`,
        audioUrl: audioUrl.substring(0, 50) + '...'
      });

      return { audioUrl, totalDurationMs };
    } catch (error) {
      console.error('[PageAudioService] ❌ Audio concatenation failed:', error);
      throw new Error(`Failed to concatenate audio: ${error}`);
    }
  }

  /**
   * Convert AudioBuffer to WAV blob
   */
  private audioBufferToWav(buffer: AudioBuffer): Blob {
    const length = buffer.length;
    const sampleRate = buffer.sampleRate;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    // Convert float samples to 16-bit PCM
    const channelData = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  private estimateSentenceTimestamps(sentences: Sentence[], totalDurationMs: number): SentenceTimestamp[] {
    // Advanced timing estimation with speech pattern analysis
    console.log('[PageAudioService] Advanced timing estimation for', sentences.length, 'sentences, total duration:', totalDurationMs);
    
    // Analyze sentence characteristics for better timing
    const sentenceData = sentences.map(s => {
      const text = s.text_raw.trim();
      const charCount = text.length;
      const wordCount = text.split(/\s+/).length;
      const punctuation = (text.match(/[。、！？]/g) || []).length;
      const isDialog = text.includes('「') || text.includes('」');
      const isShort = charCount < 20;
      
      // Complex sentences need more time per character
      const complexity = punctuation + (isDialog ? 0.3 : 0) + (wordCount > 10 ? 0.2 : 0);
      const speedFactor = 1 + (complexity * 0.1) + (isShort ? 0.2 : 0); // Short sentences need proportionally more time
      
      return { text, charCount, wordCount, punctuation, isDialog, isShort, speedFactor };
    });
    
    // Calculate weighted duration based on complexity
    const totalWeightedChars = sentenceData.reduce((sum, data) => sum + (data.charCount * data.speedFactor), 0);
    
    // More sophisticated pause calculation - reduce pauses, extend speech time
    const basePauseDuration = 200; // Reduced from 300ms - TTS has less pause than expected
    const totalPauses = Math.max(0, sentences.length - 1) * basePauseDuration;
    const speechDuration = Math.max(totalDurationMs - totalPauses, totalDurationMs * 0.92); // Increased from 0.85 - more time for actual speech
    
    console.log('[PageAudioService] Advanced timing calculation:', {
      totalDurationMs,
      totalPauses,
      speechDuration,
      totalWeightedChars,
      avgMsPerWeightedChar: speechDuration / totalWeightedChars,
      complexity: sentenceData.map(d => ({ chars: d.charCount, factor: d.speedFactor }))
    });
    
    let currentTimeMs = 0;
    const result = sentences.map((sentence, index) => {
      const data = sentenceData[index];
      const weightedDuration = (data.charCount * data.speedFactor / totalWeightedChars) * speechDuration;
      
      const startTimeMs = Math.round(currentTimeMs);
      
      // Add overlap buffer to ensure we don't miss sentence beginnings
      const overlapBuffer = index > 0 ? 150 : 0; // 150ms overlap with previous sentence
      const effectiveStartTimeMs = Math.max(0, startTimeMs - overlapBuffer);
      
      const endTimeMs = Math.round(currentTimeMs + weightedDuration);
      
      // Move to next sentence with pause (dynamic pause based on sentence ending)
      const dynamicPause = data.text.endsWith('。') ? basePauseDuration * 0.8 : basePauseDuration * 0.6; // Reduced pause multipliers
      currentTimeMs = endTimeMs + (index < sentences.length - 1 ? dynamicPause : 0);
      
      const timestamp = {
        sentenceIndex: index, // Use page-relative index (array index)
        startTimeMs: effectiveStartTimeMs, // Use overlap-adjusted start time
        endTimeMs,
        text: sentence.text_raw
      };
      
      console.log(`[PageAudioService] ⏱️ Created timestamp for sentence ${index} (global: ${sentence.index}):`, {
        globalIndex: sentence.index,
        pageLocalIndex: index,
        originalStartTimeMs: startTimeMs,
        effectiveStartTimeMs,
        overlapBuffer,
        endTimeMs,
        text: sentence.text_raw.substring(0, 30) + '...'
      });
      
      console.log('[PageAudioService] Advanced sentence timing:', {
        index: sentence.index,
        charCount: data.charCount,
        speedFactor: data.speedFactor,
        weightedDuration: Math.round(weightedDuration),
        originalStart: startTimeMs,
        effectiveStart: effectiveStartTimeMs,
        end: endTimeMs,
        overlapMs: overlapBuffer,
        nextPause: index < sentences.length - 1 ? Math.round(dynamicPause) : 0,
        complexity: { punctuation: data.punctuation, isDialog: data.isDialog, isShort: data.isShort },
        text: sentence.text_raw.substring(0, 40) + '...'
      });
      
      return timestamp;
    });
    
    console.log('🎯🎯🎯 CRITICAL DEBUG: Final timestamps created:', result.map(t => ({
      sentenceIndex: t.sentenceIndex,
      startTimeMs: t.startTimeMs,
      endTimeMs: t.endTimeMs
    })));
    
    console.log('🎯🎯🎯 SENTENCE INDEXES IN TIMESTAMPS:', result.map(t => t.sentenceIndex));
    
    return result;
  }

  private async generateFallbackPageAudio(sentences: Sentence[]): Promise<PageAudio> {
    // For fallback, we'll still try to create a cohesive experience
    // by generating individual sentences and providing estimated timing
    
    const sentenceTimestamps: SentenceTimestamp[] = [];
    let currentTimeMs = 0;
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const estimatedDuration = sentence.text_raw.length * 120; // Conservative estimate
      
      sentenceTimestamps.push({
        sentenceIndex: i,
        startTimeMs: currentTimeMs,
        endTimeMs: currentTimeMs + estimatedDuration,
        text: sentence.text_raw
      });
      
      currentTimeMs += estimatedDuration + 300; // Add pause
    }

    // For fallback, we don't have a single audio file
    // The player will need to handle this case differently
    return {
      audioId: `fallback_${Date.now()}`,
      audioUrl: '', // Empty indicates fallback mode
      totalDurationMs: currentTimeMs,
      sentenceTimestamps
    };
  }

  async preloadPageAudio(documentId: string, pageIndex: number, sentences: Sentence[]): Promise<void> {
    try {
      await this.getPageAudio(documentId, pageIndex, sentences);
    } catch (error) {
      console.warn(`Failed to preload page audio for ${documentId}:${pageIndex}`, error);
    }
  }

  // Smart prefetching based on cache state
  async smartPrefetch(documentId: string, pageIndex: number, allPages: {pageIndex: number, sentences: Sentence[]}[], maxPages: number): Promise<void> {
    const documentCache = this.getDocumentCache(documentId);
    documentCache.setCurrentPage(pageIndex);
    const prefetchTargets = documentCache.getPrefetchTargets();
    
    console.log(`[PageAudioService] 🎯 Smart prefetch for document ${documentId} page ${pageIndex}:`, {
      targets: prefetchTargets,
      cacheStats: documentCache.getStats()
    });

    // Filter valid page numbers
    const validTargets = prefetchTargets.filter((p: number) => p >= 0 && p < maxPages);
    
    // Prefetch in parallel (but limit concurrency)
    const prefetchPromises = validTargets.map(async (targetPage: number) => {
      const pageData = allPages.find(p => p.pageIndex === targetPage);
      if (pageData) {
        console.log(`[PageAudioService] 🚀 Prefetching document ${documentId} page ${targetPage}`);
        await this.preloadPageAudio(documentId, targetPage, pageData.sentences);
      }
    });

    try {
      await Promise.all(prefetchPromises);
      console.log(`[PageAudioService] ✅ Smart prefetch completed for document ${documentId}:`, documentCache.getStats());
    } catch (error) {
      console.warn('[PageAudioService] Some prefetch operations failed:', error);
    }
  }

  // Get cache statistics for all documents
  getCacheStats() {
    const allStats = Array.from(this.documentCaches.entries()).map(([documentId, cache]) => ({
      documentId,
      stats: cache.getStats()
    }));
    return {
      totalDocuments: this.documentCaches.size,
      documentCaches: allStats
    };
  }

  getCurrentSentence(pageAudio: PageAudio, currentTimeMs: number): SentenceTimestamp | null {
    return pageAudio.sentenceTimestamps.find(
      timestamp => currentTimeMs >= timestamp.startTimeMs && currentTimeMs <= timestamp.endTimeMs
    ) || null;
  }

  getSentenceAtTime(pageAudio: PageAudio, timeMs: number): SentenceTimestamp | null {
    return pageAudio.sentenceTimestamps.find(
      timestamp => timeMs >= timestamp.startTimeMs && timeMs <= timestamp.endTimeMs
    ) || null;
  }

  jumpToSentence(pageAudio: PageAudio, sentenceIndex: number): number {
    console.log('[PageAudioService] jumpToSentence called with sentenceIndex:', sentenceIndex);
    
    const availableIndexes = pageAudio.sentenceTimestamps.map(t => t.sentenceIndex).sort((a, b) => a - b);
    console.log('[PageAudioService] Available sentence indexes:', availableIndexes);
    console.log('[PageAudioService] Looking for sentence index:', sentenceIndex);
    console.log('[PageAudioService] Index exists?:', availableIndexes.includes(sentenceIndex));
    
    const timestamp = pageAudio.sentenceTimestamps.find(t => t.sentenceIndex === sentenceIndex);
    if (timestamp) {
      const startTime = timestamp.startTimeMs;
      console.log('[PageAudioService] ✅ Found timestamp for sentence', sentenceIndex, ':', {
        startTimeMs: startTime,
        startTimeSec: startTime / 1000,
        endTimeMs: timestamp.endTimeMs,
        text: timestamp.text.substring(0, 50)
      });
      return startTime;
    }
    
    console.error('[PageAudioService] ❌ No timestamp found for sentence', sentenceIndex);
    console.error('[PageAudioService] Available indexes:', availableIndexes);
    console.error('[PageAudioService] Requested index:', sentenceIndex);
    console.error('[PageAudioService] This indicates a page boundary mapping issue!');
    
    // Fallback: return 0 to start from beginning
    return 0;
  }
}

export const pageAudioService = PageAudioService.getInstance();