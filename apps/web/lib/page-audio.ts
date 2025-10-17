import { getTtsProvider } from '@/providers/tts';
import { ACTIVE_TTS_PROVIDER } from '@/lib/config';
import { smartCache } from '@/lib/smart-cache';
import type { Sentence } from '@/lib/types';
import type { TtsMark } from '@/providers/tts/types';

export interface SentenceTimestamp {
  sentenceIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
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
    console.log('[PageAudioService] Building page text with timing markers for', sentences.length, 'sentences');
    
    // Use SSML with mark tags for precise timing tracking
    let ssmlText = '';
    
    sentences.forEach((sentence, index) => {
      // Add start marker for this sentence
      ssmlText += `<mark name="sentence_${index}_start"/>`;
      
      // Add the sentence text
      ssmlText += sentence.text_raw;
      
      // Add end marker for this sentence
      ssmlText += `<mark name="sentence_${index}_end"/>`;
      
      // Add natural pause between sentences (except last one)
      if (index < sentences.length - 1) {
        ssmlText += '<break time="500ms" />';
      }
    });

    console.log('[PageAudioService] Generated SSML with timing markers:', ssmlText);
    console.log('[PageAudioService] SSML text length:', ssmlText.length);
    console.log('[PageAudioService] Number of sentences:', sentences.length);
    console.log('[PageAudioService] Expected markers:', sentences.length * 2);
    
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
          sentenceIndex: sentence.index, // Use the actual sentence index, not array index
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
          sentenceIndex: sentence.index, // Use the actual sentence index, not array index
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
    
    // Return cached result if available
    if (this.cache.has(pageKey)) {
      return this.cache.get(pageKey)!;
    }

    // Return existing loading promise if in progress
    if (this.loadingPromises.has(pageKey)) {
      return this.loadingPromises.get(pageKey)!;
    }

    // Check smart cache first
    const cacheKey = `page_audio:${pageKey}`;
    const cachedPageAudio = smartCache.get(cacheKey);
    if (cachedPageAudio) {
      const pageAudio = JSON.parse(cachedPageAudio) as PageAudio;
      this.cache.set(pageKey, pageAudio);
      return pageAudio;
    }

    // Generate new page audio
    const loadingPromise = this.generatePageAudio(documentId, pageIndex, sentences);
    this.loadingPromises.set(pageKey, loadingPromise);

    try {
      const pageAudio = await loadingPromise;
      
      // Cache the result
      this.cache.set(pageKey, pageAudio);
      smartCache.set(cacheKey, JSON.stringify(pageAudio));
      
      return pageAudio;
    } finally {
      this.loadingPromises.delete(pageKey);
    }
  }

  private async generatePageAudio(documentId: string, pageIndex: number, sentences: Sentence[]): Promise<PageAudio> {
    if (sentences.length === 0) {
      throw new Error('No sentences to generate audio for');
    }

    console.log('[PageAudioService] Generating page audio for', sentences.length, 'sentences');
    console.log('[PageAudioService] Sentence indexes:', sentences.map(s => s.index));
    console.log('[PageAudioService] Sentence texts:', sentences.map(s => s.text_raw.substring(0, 50) + '...'));

    const provider = getTtsProvider(ACTIVE_TTS_PROVIDER);
    console.log('[PageAudioService] Using TTS provider:', provider.id);
    
    // Build text with sentence markers for timing
    const markedText = this.buildPageTextWithMarkers(sentences);
    
    try {
      console.log('[PageAudioService] Calling TTS provider with marked text...');
      // Generate audio for entire page
      const result = await provider.speakSentence(markedText, 'ja');
      console.log('[PageAudioService] TTS result:', {
        audioId: result.audioId,
        durationMs: result.durationMs,
        marksCount: result.marks?.length || 0,
        marks: result.marks?.map(m => ({ tag: m.tag, offsetMs: m.offsetMs })) || []
      });
      
      const audioUrl = await provider.getAudioUrl(result.audioId);
      console.log('[PageAudioService] Got audio URL:', audioUrl.substring(0, 100) + '...');
      
      // Parse sentence timestamps from TTS marks - prefer actual markers over estimation
      const sentenceTimestamps = result.marks && result.marks.length > 0
        ? this.parseSentenceTimestamps(sentences, result.marks)
        : this.estimateSentenceTimestamps(sentences, result.durationMs);

      console.log('[PageAudioService] Timing method used:', result.marks && result.marks.length > 0 ? 'TTS_MARKERS' : 'ESTIMATION');
      console.log('[PageAudioService] Generated sentence timestamps:', sentenceTimestamps.map(t => ({
        index: t.sentenceIndex,
        start: t.startTimeMs,
        end: t.endTimeMs,
        duration: t.endTimeMs - t.startTimeMs,
        text: t.text.substring(0, 30) + '...'
      })));

      const pageAudio: PageAudio = {
        audioId: result.audioId,
        audioUrl,
        totalDurationMs: result.durationMs,
        sentenceTimestamps
      };

      // Debug log the page audio details
      console.log('[PageAudioService] Generated page audio:', {
        audioUrl,
        totalDurationMs: result.durationMs,
        marksCount: result.marks?.length || 0,
        timestampsCount: sentenceTimestamps.length,
        sentenceIndexes: sentences.map(s => s.index),
        timestamps: sentenceTimestamps.map(t => ({
          index: t.sentenceIndex,
          start: t.startTimeMs,
          end: t.endTimeMs
        }))
      });

      return pageAudio;
    } catch (error) {
      console.error('Failed to generate page audio:', error);
      
      // Fallback: generate individual sentence audio and estimate concatenation
      return this.generateFallbackPageAudio(sentences);
    }
  }

  private estimateSentenceTimestamps(sentences: Sentence[], totalDurationMs: number): SentenceTimestamp[] {
    // Account for breaks between sentences (500ms each, from SSML)
    const totalBreaks = Math.max(0, sentences.length - 1) * 500; // 500ms breaks between sentences
    const speechDuration = totalDurationMs - totalBreaks;
    
    const totalChars = sentences.reduce((sum, s) => sum + s.text_raw.length, 0);
    const msPerChar = speechDuration / totalChars;
    
    console.log('[PageAudioService] Timing estimation:', {
      totalDurationMs,
      totalBreaks,
      speechDuration,
      totalChars,
      msPerChar,
      sentenceCount: sentences.length
    });
    
    let currentTimeMs = 0;
    return sentences.map((sentence, index) => {
      const startTimeMs = currentTimeMs;
      const durationMs = sentence.text_raw.length * msPerChar;
      const endTimeMs = startTimeMs + durationMs;
      
      // Add break time before next sentence (except for last sentence)
      currentTimeMs = endTimeMs + (index < sentences.length - 1 ? 500 : 0);
      
      const timestamp = {
        sentenceIndex: sentence.index, // Use the actual sentence index
        startTimeMs: Math.round(startTimeMs),
        endTimeMs: Math.round(endTimeMs),
        text: sentence.text_raw
      };
      
      console.log('[PageAudioService] Sentence timing:', {
        index: sentence.index,
        textLength: sentence.text_raw.length,
        start: timestamp.startTimeMs,
        end: timestamp.endTimeMs,
        duration: timestamp.endTimeMs - timestamp.startTimeMs,
        text: sentence.text_raw.substring(0, 30) + '...'
      });
      
      return timestamp;
    });
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
    const timestamp = pageAudio.sentenceTimestamps.find(t => t.sentenceIndex === sentenceIndex);
    return timestamp ? timestamp.startTimeMs : 0;
  }
}

export const pageAudioService = PageAudioService.getInstance();