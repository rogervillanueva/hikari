'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { pageAudioService, type PageAudio, type SentenceTimestamp } from '@/lib/page-audio';
import { logAudioDebug } from '@/lib/audio-debug';
import { logReaderEvent } from '@/lib/reader-debug';
import type { Sentence } from '@/lib/types';

interface PageAudioPlayerProps {
  documentId: string;
  pageIndex: number;
  sentences: Sentence[];
  onCurrentSentenceChange?: (sentenceIndex: number | null) => void;
  className?: string;
}

export interface PageAudioPlayerRef {
  jumpToSentence: (sentenceIndex: number) => Promise<void>;
  pause: () => void;
  play: () => Promise<void>;
  isPlaying: () => boolean;
}

export const PageAudioPlayer = forwardRef<PageAudioPlayerRef, PageAudioPlayerProps>(({
  documentId,
  pageIndex,
  sentences,
  onCurrentSentenceChange,
  className = ''
}, ref) => {
  void logReaderEvent('PageAudioPlayer', 'component_init', {
    documentId,
    pageIndex,
    sentenceCount: sentences.length,
    sentenceIndexes: sentences.map(s => s.index)
  });
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [pageAudio, setPageAudio] = useState<PageAudio | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentSentence, setCurrentSentence] = useState<SentenceTimestamp | null>(null);
  const [loadingSentenceIndex, setLoadingSentenceIndex] = useState<number | null>(null);
  
  // Separate state for progress bar to avoid sentence-change interference
  const [progressTime, setProgressTime] = useState(0);
  
  // Use ref to store the most up-to-date time for seeker calculations
  const currentTimeRef = useRef(0);

  // Initialize audio element
  const getAudioElement = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (!audioRef.current) {
      void logAudioDebug('audio_element_created', {});
      const audio = new Audio();
      audio.preload = 'auto';
      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  // Load page audio
  const loadPageAudio = useCallback(async () => {
    if (sentences.length === 0) {
      void logReaderEvent('PageAudioPlayer', 'no_sentences_to_load', { documentId, pageIndex });
      void logAudioDebug('no_sentences', { documentId, pageIndex });
      return;
    }
    
    void logReaderEvent('PageAudioPlayer', 'loading_page_audio_started', {
      documentId,
      pageIndex,
      sentenceCount: sentences.length,
      sentenceIndexes: sentences.map(s => s.index)
    });
    
    void logAudioDebug('loading_page_audio', {
      documentId,
      pageIndex,
      sentenceCount: sentences.length,
      sentenceIndexes: sentences.map(s => s.index)
    });
    
    setIsLoading(true);
    try {
      const audio = await pageAudioService.getPageAudio(documentId, pageIndex, sentences);
      
      void logReaderEvent('PageAudioPlayer', 'page_audio_loaded_successfully', {
        audioUrl: audio.audioUrl,
        duration: audio.totalDurationMs,
        timestampCount: audio.sentenceTimestamps.length,
        timestamps: audio.sentenceTimestamps.map(t => ({
          index: t.sentenceIndex,
          start: t.startTimeMs,
          end: t.endTimeMs
        }))
      });
      
      void logAudioDebug('page_audio_loaded', {
        audioUrl: audio.audioUrl,
        duration: audio.totalDurationMs,
        timestampCount: audio.sentenceTimestamps.length,
        timestamps: audio.sentenceTimestamps.slice(0, 3)
      });
      
      setPageAudio(audio);
      // Don't set duration here - let the audio element's loadedmetadata event handle it
      // This ensures we get the actual audio duration, not an estimate
    } catch (error) {
      void logReaderEvent('PageAudioPlayer', 'page_audio_load_failed', {
        error: error instanceof Error ? error.message : String(error),
        documentId,
        pageIndex,
        sentenceCount: sentences.length
      });
      
      void logAudioDebug('page_audio_error', { error: error instanceof Error ? error.message : String(error) });
      console.error('Failed to load page audio:', error);
    } finally {
      setIsLoading(false);
      void logReaderEvent('PageAudioPlayer', 'loading_completed', { documentId, pageIndex });
    }
  }, [documentId, pageIndex, sentences]);

  // Setup audio element when page audio is loaded
  useEffect(() => {
    const audio = getAudioElement();
    if (!audio || !pageAudio) return;

    // Define all event handlers first
    const handleLoadedMetadata = () => {
      void logAudioDebug('audio_metadata_loaded', {
        duration: audio.duration,
        src: audio.src
      });
      setDuration(audio.duration);
    };

    const handleTimeUpdate = () => {
      const currentTimeMs = audio.currentTime * 1000;
      const newCurrentTime = audio.currentTime;
      
      // Update ref immediately for seeker calculations
      currentTimeRef.current = newCurrentTime;
      
      // Always update progress time for smooth seeker movement
      setProgressTime(newCurrentTime);
      
      // Find current sentence with improved logic
      const sentence = pageAudioService.getCurrentSentence(pageAudio, currentTimeMs);
      
      // Only update main currentTime state if there's a meaningful change to prevent excessive re-renders
      if (Math.abs(currentTime - newCurrentTime) > 0.05) { // 50ms threshold
        setCurrentTime(newCurrentTime);
      }
      
      // Only change sentences when we have a definitive new sentence
      // Don't change to null (gaps between sentences) unless we're really past all sentences
      const shouldChangeSentence = sentence !== null && sentence !== currentSentence;
      
      if (shouldChangeSentence) {
        void logAudioDebug('sentence_changed', {
          previousSentence: currentSentence?.sentenceIndex,
          newSentence: sentence?.sentenceIndex,
          currentTime: newCurrentTime,
          currentTimeMs,
          audioCurrentTime: audio.currentTime,
          seekerPosition: ((newCurrentTime / audio.duration) * 100),
          availableTimestamps: pageAudio.sentenceTimestamps.map(t => ({
            index: t.sentenceIndex,
            start: t.startTimeMs,
            end: t.endTimeMs,
            text: t.text.substring(0, 20) + '...'
          }))
        });
        setCurrentSentence(sentence);
        onCurrentSentenceChange?.(sentence?.sentenceIndex ?? null);
      }
    };

    const handleEnded = () => {
      void logAudioDebug('audio_ended', {});
      setIsPlaying(false);
      setCurrentSentence(null);
      onCurrentSentenceChange?.(null);
    };

    const handlePlay = () => {
      void logAudioDebug('audio_play_event', { currentTime: audio.currentTime });
      setIsPlaying(true);
    };
    
    const handlePause = () => {
      void logAudioDebug('audio_pause_event', { currentTime: audio.currentTime });
      setIsPlaying(false);
    };

    const handleCanPlay = () => {
      void logAudioDebug('audio_can_play', {
        paused: audio.paused,
        currentTime: audio.currentTime,
        duration: audio.duration,
        readyState: audio.readyState
      });
      // Ensure we have the correct playing state when audio is ready
      setIsPlaying(!audio.paused);
    };

    const handleLoadStart = () => {
      void logAudioDebug('audio_load_start', { src: audio.src });
    };

    const handleLoadedData = () => {
      void logAudioDebug('audio_loaded_data', {
        duration: audio.duration,
        readyState: audio.readyState
      });
    };

    const handleError = (event: Event) => {
      void logAudioDebug('audio_error', {
        error: (event.target as HTMLAudioElement)?.error?.message || 'Unknown audio error',
        src: audio.src,
        readyState: audio.readyState
      });
    };

    // Set up the audio source only if URL has changed
    if (pageAudio.audioUrl && audio.src !== pageAudio.audioUrl) {
      void logAudioDebug('setting_audio_source', { 
        audioUrl: pageAudio.audioUrl,
        previousSrc: audio.src,
        totalDuration: pageAudio.totalDurationMs,
        timestampCount: pageAudio.sentenceTimestamps.length
      });
      audio.src = pageAudio.audioUrl;
      // Only load when source actually changes
      audio.load();
    }

    // Attach all event handlers
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('loadeddata', handleLoadedData);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('loadeddata', handleLoadedData);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('error', handleError);
    };
  }, [pageAudio?.audioUrl, pageAudio?.sentenceTimestamps, currentSentence, onCurrentSentenceChange, getAudioElement]);

  // Load page audio on mount
  useEffect(() => {
    void logReaderEvent('PageAudioPlayer', 'load_page_audio_triggered', {
      documentId,
      pageIndex,
      sentenceCount: sentences.length
    });
    void loadPageAudio();
  }, [loadPageAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
      }
    };
  }, []);

  const handlePlayPause = useCallback(async () => {
    const audio = getAudioElement();
    void logAudioDebug('play_pause_clicked', {
      hasAudio: !!audio,
      hasPageAudio: !!pageAudio,
      isPlaying,
      audioSrc: audio?.src,
      audioPaused: audio?.paused,
      audioCurrentTime: audio?.currentTime,
      audioDuration: audio?.duration,
      audioReadyState: audio?.readyState
    });
    
    if (!audio || !pageAudio) {
      void logAudioDebug('play_pause_failed', { reason: 'missing_audio_or_page_audio' });
      return;
    }

    // Ensure audio is loaded before trying to play
    if (audio.readyState < 2) { // HAVE_CURRENT_DATA
      void logAudioDebug('audio_not_ready', { readyState: audio.readyState });
      // Try to load the audio first
      audio.load();
      return;
    }

    // Use the audio element's paused state directly instead of our isPlaying state
    // This ensures we have the most accurate state
    if (!audio.paused) {
      void logAudioDebug('pausing_audio', { currentTime: audio.currentTime });
      audio.pause();
    } else {
      void logAudioDebug('playing_audio', { currentTime: audio.currentTime });
      try {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          await playPromise;
        }
      } catch (error) {
        void logAudioDebug('play_failed', { error: error instanceof Error ? error.message : String(error) });
        console.error('Failed to play audio:', error);
      }
    }
  }, [isPlaying, pageAudio, getAudioElement]);

  const handleRewind = useCallback(() => {
    const audio = getAudioElement();
    if (!audio) return;
    
    audio.currentTime = Math.max(0, audio.currentTime - 5);
  }, [getAudioElement]);

  const [isDragging, setIsDragging] = useState(false);

  const seekToPosition = useCallback((clientX: number, rect: DOMRect) => {
    const audio = getAudioElement();
    if (!audio || !pageAudio || duration === 0) return;

    const clickX = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = percentage * duration;
    
    void logAudioDebug('seeking', {
      clickX,
      percentage,
      newTime,
      duration,
      oldTime: audio.currentTime,
      oldSentence: currentSentence?.sentenceIndex
    });
    
    // Set audio time - this is the authoritative time source
    audio.currentTime = newTime;
    
    // Update ref and progress time immediately for instant visual feedback
    currentTimeRef.current = newTime;
    setProgressTime(newTime);
    
    // DO NOT update main currentTime state immediately - let timeUpdate handle it
    // This prevents the seeker from jumping
    // setCurrentTime(newTime);  // REMOVED - was causing jumps
    
    // Find and set current sentence
    const currentTimeMs = newTime * 1000;
    const sentence = pageAudioService.getCurrentSentence(pageAudio, currentTimeMs);
    
    void logAudioDebug('seek_sentence_result', {
      seekTimeMs: currentTimeMs,
      foundSentence: sentence?.sentenceIndex,
      previousSentence: currentSentence?.sentenceIndex,
      availableTimestamps: pageAudio.sentenceTimestamps.map(t => ({
        index: t.sentenceIndex,
        start: t.startTimeMs,
        end: t.endTimeMs,
        contains: currentTimeMs >= t.startTimeMs && currentTimeMs <= t.endTimeMs
      }))
    });
    
    if (sentence !== currentSentence) {
      setCurrentSentence(sentence);
      onCurrentSentenceChange?.(sentence?.sentenceIndex ?? null);
    }
  }, [duration, pageAudio, currentSentence, onCurrentSentenceChange, getAudioElement]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekToPosition(e.clientX, rect);
  }, [seekToPosition]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    seekToPosition(e.clientX, rect);
  }, [seekToPosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seekToPosition(e.clientX, rect);
  }, [isDragging, seekToPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global mouse up listener for drag
  useEffect(() => {
    if (!isDragging) return;
    
    const handleGlobalMouseUp = () => setIsDragging(false);
    document.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging]);

  const jumpToSentence = useCallback(async (sentenceIndex: number) => {
    console.log('[PageAudioPlayer] jumpToSentence called', { sentenceIndex });
    
    const audio = getAudioElement();
    if (!audio || !pageAudio) {
      console.log('[PageAudioPlayer] jumpToSentence failed - missing audio or pageAudio', {
        hasAudio: !!audio,
        hasPageAudio: !!pageAudio
      });
      return;
    }

    if (pageAudio.audioUrl) {
      // Normal mode: jump to timestamp in single audio file
      const timeMs = pageAudioService.jumpToSentence(pageAudio, sentenceIndex);
      const targetTime = timeMs / 1000;
      
      void logAudioDebug('jumpToSentence', {
        sentenceIndex,
        timeMs,
        targetTime,
        currentAudioTime: audio.currentTime
      });
      
      // Set the audio time - let timeUpdate handler manage state updates
      audio.currentTime = targetTime;
      
      // Update ref and progress time immediately for instant visual feedback  
      currentTimeRef.current = targetTime;
      setProgressTime(targetTime);
      
      // DO NOT update main currentTime state immediately - let timeUpdate handle it
      // This prevents race conditions and jumpy seeker behavior
      // setCurrentTime(targetTime);  // REMOVED
      
      // Find the sentence timestamp for immediate sentence highlighting
      const timestamp = pageAudio.sentenceTimestamps.find(t => t.sentenceIndex === sentenceIndex);
      if (timestamp) {
        void logAudioDebug('jumpToSentence_found_timestamp', { timestamp });
        setCurrentSentence(timestamp);
        onCurrentSentenceChange?.(sentenceIndex);
      } else {
        void logAudioDebug('jumpToSentence_no_timestamp', { 
          sentenceIndex, 
          availableIndexes: pageAudio.sentenceTimestamps.map(t => t.sentenceIndex) 
        });
      }
      
      // Start playing if not already playing
      if (audio.paused) {
        console.log('[PageAudioPlayer] Starting playback after jump');
        try {
          await audio.play();
        } catch (error) {
          console.error('Failed to start playback after jump:', error);
        }
      }
    } else {
      console.log('[PageAudioPlayer] Using fallback mode - no audioUrl');
      // Fallback mode: generate individual sentence audio
      setLoadingSentenceIndex(sentenceIndex);
      try {
        const sentence = sentences[sentenceIndex];
        if (sentence) {
          // This would trigger individual sentence TTS generation
          // For now, we'll simulate the jump
          const timestamp = pageAudio.sentenceTimestamps.find(t => t.sentenceIndex === sentenceIndex);
          if (timestamp) {
            setCurrentTime(timestamp.startTimeMs / 1000);
            setCurrentSentence(timestamp);
            onCurrentSentenceChange?.(sentenceIndex);
          }
        }
      } catch (error) {
        console.error('Failed to jump to sentence:', error);
      } finally {
        setLoadingSentenceIndex(null);
      }
    }
  }, [pageAudio, sentences, onCurrentSentenceChange, getAudioElement]);

  const pause = useCallback(() => {
    const audio = getAudioElement();
    if (audio && !audio.paused) {
      audio.pause();
    }
  }, [getAudioElement]);

  const play = useCallback(async () => {
    const audio = getAudioElement();
    if (audio && audio.paused) {
      try {
        await audio.play();
      } catch (error) {
        console.error('Failed to play audio:', error);
        throw error;
      }
    }
  }, [getAudioElement]);

  const isPlayingMethod = useCallback(() => {
    return isPlaying;
  }, [isPlaying]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    jumpToSentence,
    pause,
    play,
    isPlaying: isPlayingMethod
  }), [jumpToSentence, pause, play, isPlayingMethod]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage using dedicated progress time state
  // This is completely isolated from sentence logic to prevent jumps
  const progressPercentage = duration > 0 ? (progressTime / duration) * 100 : 0;

  return (
    <div className={`flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${className}`}>
      {/* Play/Pause Button */}
      <button
        onClick={handlePlayPause}
        disabled={isLoading || !pageAudio}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isLoading ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 ml-0.5" />
        )}
      </button>

      {/* Rewind 5s Button */}
      <button
        onClick={handleRewind}
        disabled={!pageAudio || duration === 0}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300 text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
        aria-label="Rewind 5 seconds"
      >
        <RotateCcw className="h-3 w-3" />
      </button>

      {/* Progress Bar */}
      <div className="flex-1 flex items-center gap-2">
        <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">
          {formatTime(currentTime)}
        </span>
        
        <div 
          className="flex-1 h-2 bg-neutral-200 rounded-full cursor-pointer dark:bg-neutral-700"
          onClick={handleSeek}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <div 
            className={`h-full bg-primary rounded-full relative ${isPlaying ? '' : 'transition-all duration-100'}`}
            style={{ width: `${progressPercentage}%` }}
          >
            {/* Draggable scrubber */}
            <div 
              className={`absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full border-2 border-white shadow-sm -mr-1.5 cursor-grab ${isDragging ? 'cursor-grabbing scale-110' : ''}`}
              onMouseDown={handleMouseDown}
            />
          </div>
        </div>
        
        <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">
          {formatTime(duration)}
        </span>
      </div>

      {/* Current Sentence Indicator */}
      {currentSentence && (
        <div className="text-xs text-neutral-600 dark:text-neutral-300">
          Sentence {currentSentence.sentenceIndex + 1}
        </div>
      )}

      {/* Loading indicator for individual sentence */}
      {loadingSentenceIndex !== null && (
        <div className="text-xs text-primary">
          Loading sentence {loadingSentenceIndex + 1}...
        </div>
      )}
    </div>
  );
});

PageAudioPlayer.displayName = 'PageAudioPlayer';

// Export the jump to sentence function for use by individual sentence buttons
export { pageAudioService };