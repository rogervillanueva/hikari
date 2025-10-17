'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ellipsis, Pause, Play } from 'lucide-react';
import {
  ACTIVE_TRANSLATION_PROVIDER,
  ACTIVE_TTS_PROVIDER,
} from '@/lib/config';
import { readerConfig } from '@/config/reader';
import { useDocumentsStore } from '@/store/documents';
import { getTtsProvider } from '@/providers/tts';
import { TouchSelectableText } from '@/components/TouchSelectableText';
import { usePreload } from '@/hooks/usePreload';
import { PageAudioPlayer, pageAudioService, type PageAudioPlayerRef } from '@/components/PageAudioPlayer';
import { logAudioDebug } from '@/lib/audio-debug';
import { logReaderEvent } from '@/lib/reader-debug';
import type { Sentence } from '@/lib/types';
import type { TranslationDirection } from '@/providers/translation/base';
import type { DocumentPage } from '@/lib/preload-service';
import { translateSentences } from '@/utils/translateSentences';

interface ReaderViewProps {
  documentId: string;
}

export function ReaderView({ documentId }: ReaderViewProps) {
  void logReaderEvent('ReaderView', 'component_init', { documentId });
  
  const router = useRouter();
  const documents = useDocumentsStore((state) => state.documents);
  const sentencesByDoc = useDocumentsStore((state) => state.sentences);
  const loadDocuments = useDocumentsStore((state) => state.loadDocuments);
  const loading = useDocumentsStore((state) => state.loading);
  const [activeSentence, setActiveSentence] = useState<number | null>(null);
  const [currentPlayingSentence, setCurrentPlayingSentence] = useState<number | null>(null);
  const playingRef = useRef(false);
  const pageAudioPlayerRef = useRef<PageAudioPlayerRef>(null);
  const [sentenceTranslations, setSentenceTranslations] = useState<Record<number, string>>({});
  const [openSentenceTranslations, setOpenSentenceTranslations] = useState<Record<number, boolean>>({});
  const [chunkTranslations, setChunkTranslations] = useState<Record<number, Record<string, string>>>({});
  const [loadingChunks, setLoadingChunks] = useState<Record<number, boolean>>({});
  const [pageIndex, setPageIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const document = useMemo(
    () => {
      const doc = documents.find((doc) => doc.id === documentId);
      void logReaderEvent('ReaderView', 'document_lookup', { 
        documentId, 
        found: !!doc, 
        title: doc?.title,
        totalDocuments: documents.length 
      });
      return doc;
    },
    [documents, documentId]
  );
  
  const sentenceList = sentencesByDoc[documentId] ?? [];
  
  void logReaderEvent('ReaderView', 'sentence_list_computed', {
    documentId,
    sentenceCount: sentenceList.length,
    sentenceIndexes: sentenceList.slice(0, 5).map(s => s.index) // First 5 for debugging
  });
  const sentencesPerPage = readerConfig.sentencesPerPage;
  const translationInstruction = readerConfig.translationInstruction;
  const chunkCharacterLimit = readerConfig.translationChunkCharacterLimit;
  const chunkPrefetchThreshold = readerConfig.translationChunkPrefetchThreshold;

  useEffect(() => {
    void logReaderEvent('ReaderView', 'load_documents_called', {});
    void loadDocuments();
  }, [loadDocuments]);



  useEffect(() => {
    void logReaderEvent('ReaderView', 'document_check', {
      hasDocument: !!document,
      documentsLength: documents.length,
      documentId
    });
    
    if (!document && documents.length) {
      void logReaderEvent('ReaderView', 'redirecting_to_documents', { reason: 'document_not_found' });
      router.replace('/documents');
    }
  }, [document, documents.length, router, documentId]);

  useEffect(() => {
    void logReaderEvent('ReaderView', 'document_id_changed', {
      newDocumentId: documentId,
      resettingState: true
    });
    
    setPageIndex(0);
    setSentenceTranslations({});
    setOpenSentenceTranslations({});
    setChunkTranslations({});
    setLoadingChunks({});
  }, [documentId]);

  const paragraphs = useMemo(() => {
    if (!sentenceList.length) return [] as Sentence[][];
    const hasParagraphData = sentenceList.some(
      (sentence) => typeof sentence.paragraphIndex === 'number'
    );
    if (!hasParagraphData) {
      return sentenceList.map((sentence) => [sentence]);
    }
    const groups: Sentence[][] = [];
    let currentParagraphIndex: number | null = null;
    let currentGroup: Sentence[] = [];
    sentenceList.forEach((sentence) => {
      const paragraphIndex = sentence.paragraphIndex ?? currentParagraphIndex ?? 0;
      if (currentParagraphIndex === null || paragraphIndex === currentParagraphIndex) {
        currentGroup.push(sentence);
      } else {
        groups.push(currentGroup);
        currentGroup = [sentence];
      }
      currentParagraphIndex = paragraphIndex;
    });
    if (currentGroup.length) {
      groups.push(currentGroup);
    }
    return groups;
  }, [sentenceList]);

  const pages = useMemo(() => {
    if (!paragraphs.length) {
      return [] as Sentence[][][];
    }

    const result: Sentence[][][] = [];
    let currentPage: Sentence[][] = [];
    let currentCount = 0;

    const pushCurrentPage = () => {
      if (currentPage.length) {
        result.push(currentPage);
        currentPage = [];
        currentCount = 0;
      }
    };

    paragraphs.forEach((paragraph) => {
      let remaining = [...paragraph];
      while (remaining.length) {
        const remainingSlots = sentencesPerPage - currentCount;
        if (remainingSlots <= 0) {
          pushCurrentPage();
          continue;
        }

        if (remaining.length <= remainingSlots) {
          currentPage.push(remaining);
          currentCount += remaining.length;
          remaining = [];
        } else {
          const chunk = remaining.slice(0, remainingSlots);
          currentPage.push(chunk);
          pushCurrentPage();
          remaining = remaining.slice(remainingSlots);
        }
      }
    });

    pushCurrentPage();

    void logReaderEvent('ReaderView', 'pages_computed', {
      paragraphCount: paragraphs.length,
      pageCount: result.length,
      sentencesPerPage,
      currentPageIndex: pageIndex
    });

    return result.length ? result : [paragraphs];
  }, [paragraphs, sentencesPerPage, pageIndex]);

  const totalPages = pages.length;
  const currentPage = pages[pageIndex] ?? [];
  
  void logReaderEvent('ReaderView', 'current_page_computed', {
    pageIndex,
    totalPages,
    currentPageParagraphs: currentPage.length,
    currentPageSentences: currentPage.flat().length,
    firstSentenceIndexes: currentPage.flat().slice(0, 3).map(s => s.index)
  });

  type TranslationChunk = {
    index: number;
    startPage: number;
    endPage: number;
    sentences: Sentence[];
    characterCount: number;
  };

  const chunks = useMemo(() => {
    if (!pages.length) {
      return [] as TranslationChunk[];
    }
    const limit = Math.max(chunkCharacterLimit, 500);
    const list: TranslationChunk[] = [];
    let current: Sentence[] = [];
    let currentChars = 0;
    let startPage = 0;
    let endPage = 0;

    const pushCurrent = () => {
      if (!current.length) {
        return;
      }
      list.push({
        index: list.length,
        startPage,
        endPage,
        sentences: current,
        characterCount: currentChars,
      });
      current = [];
      currentChars = 0;
    };

    pages.forEach((page, pageIndex) => {
      const pageSentences = page.flat();
      if (!pageSentences.length) {
        return;
      }
      pageSentences.forEach((sentence) => {
        const length = sentence.text_raw.length;
        if (current.length && currentChars + length > limit) {
          pushCurrent();
        }
        if (!current.length) {
          startPage = pageIndex;
        }
        current.push(sentence);
        currentChars += length;
        endPage = pageIndex;
      });
    });

    pushCurrent();

    return list;
  }, [pages, chunkCharacterLimit]);

  useEffect(() => {
    if (pageIndex >= totalPages && totalPages > 0) {
      setPageIndex(totalPages - 1);
    }
  }, [pageIndex, totalPages]);

  const pageToChunkIndex = useMemo(() => {
    const map = new Map<number, number>();
    chunks.forEach((chunk, index) => {
      for (let page = chunk.startPage; page <= chunk.endPage; page += 1) {
        map.set(page, index);
      }
    });
    return map;
  }, [chunks]);

  const sentenceToPageIndex = useMemo(() => {
    const map = new Map<number, number>();
    pages.forEach((page, index) => {
      page.forEach((paragraph) => {
        paragraph.forEach((sentence) => {
          map.set(sentence.index, index);
        });
      });
    });
    return map;
  }, [pages]);

  const sentenceToChunkIndex = useMemo(() => {
    const map = new Map<number, number>();
    chunks.forEach((chunk, index) => {
      chunk.sentences.forEach((sentence) => {
        map.set(sentence.index, index);
      });
    });
    return map;
  }, [chunks]);

  const sourceLanguage = document?.lang_source ?? 'ja';
  const direction: TranslationDirection = sourceLanguage === 'en' ? 'en-ja' : 'ja-en';

  // Transform pages for preload service
  const documentPages: DocumentPage[] = useMemo(() => 
    pages.map((page, index) => {
      const sentences = page.flat().map(s => s.text_raw);
      const content = sentences.join(' ');
      return {
        documentId: documentId,
        pageIndex: index,
        content,
        sentences,
      };
    }), [pages, documentId]
  );

  // Get sentences for current page (memoized to prevent unnecessary re-renders)
  const currentPageSentences = useMemo(() => {
    return pages[pageIndex]?.flat() || [];
  }, [pages, pageIndex]);
  
  void logReaderEvent('ReaderView', 'current_page_sentences_computed', {
    pageIndex,
    sentenceCount: currentPageSentences.length,
    sentenceIndexes: currentPageSentences.map(s => s.index),
    sentenceTexts: currentPageSentences.slice(0, 2).map(s => s.text_raw.substring(0, 50)) // First 50 chars of first 2 sentences
  });

  // Initialize smart preloading 🚀
  usePreload({
    documentId,
    currentPageIndex: pageIndex,
    pages: documentPages,
    direction,
    enabled: true,
  });

  // Handle page transitions - reset audio state when page changes
  const prevPageIndexRef = useRef(pageIndex);
  useEffect(() => {
    const prevPageIndex = prevPageIndexRef.current;
    const currentPageIndex = pageIndex;
    
    if (prevPageIndex !== currentPageIndex) {
      void logReaderEvent('ReaderView', 'page_transition_audio_reset', {
        fromPage: prevPageIndex,
        toPage: currentPageIndex,
        hadAudioPlayer: !!pageAudioPlayerRef.current,
        wasPlaying: pageAudioPlayerRef.current?.isPlaying() || false,
        currentPlayingSentence
      });
      
      // Reset audio state when switching pages
      if (pageAudioPlayerRef.current) {
        // Pause any playing audio
        pageAudioPlayerRef.current.pause();
        
        void logReaderEvent('ReaderView', 'page_transition_audio_paused', {
          fromPage: prevPageIndex,
          toPage: currentPageIndex
        });
      }
      
      // Clear current playing sentence to reset highlighting
      setCurrentPlayingSentence(null);
      
      void logReaderEvent('ReaderView', 'page_transition_state_reset', {
        fromPage: prevPageIndex,
        toPage: currentPageIndex,
        resetCurrentPlayingSentence: true
      });
    }
    
    // Update the ref for the next comparison
    prevPageIndexRef.current = currentPageIndex;
  }, [pageIndex, currentPlayingSentence]);

  const ensureChunkTranslations = useCallback(
    async (targetChunk: number) => {
      if (!document) {
        return;
      }
      if (targetChunk < 0 || targetChunk >= chunks.length) {
        return;
      }
      if (chunkTranslations[targetChunk] || loadingChunks[targetChunk]) {
        return;
      }

      const chunk = chunks[targetChunk];
      const sentencesForChunk = chunk.sentences;
      if (!sentencesForChunk.length) {
        setChunkTranslations((prev) => ({ ...prev, [targetChunk]: {} }));
        return;
      }

      setLoadingChunks((prev) => ({ ...prev, [targetChunk]: true }));
      try {
        const { translations } = await translateSentences({
          sentences: sentencesForChunk.map((sentence) => ({
            id: sentence.id,
            text: sentence.text_raw,
          })),
          direction,
          documentId: document.id,
          batchSize: sentencesForChunk.length,
          maxCharactersPerBatch: Math.max(chunk.characterCount, chunkCharacterLimit),
          instruction: translationInstruction,
        });

        setChunkTranslations((prev) => ({ ...prev, [targetChunk]: translations }));
        setSentenceTranslations((prev) => {
          const updates: Record<number, string> = {};
          sentencesForChunk.forEach((sentence) => {
            const translated = translations[sentence.id];
            if (translated) {
              updates[sentence.index] = translated;
            }
          });
          if (!Object.keys(updates).length) {
            return prev;
          }
          return { ...prev, ...updates };
        });
      } catch (error) {
        console.error('Failed to translate chunk', error);
        setChunkTranslations((prev) => ({ ...prev, [targetChunk]: {} }));
      } finally {
        setLoadingChunks((prev) => {
          const next = { ...prev };
          delete next[targetChunk];
          return next;
        });
      }
    },
    [
      document,
      chunks,
      chunkTranslations,
      loadingChunks,
      direction,
      chunkCharacterLimit,
      translationInstruction,
    ]
  );

  const ensurePageTranslations = useCallback(
    async (targetPage: number) => {
      if (!document) {
        return;
      }
      if (targetPage < 0 || targetPage >= pages.length) {
        return;
      }
      const chunkIndex = pageToChunkIndex.get(targetPage);
      if (typeof chunkIndex !== 'number') {
        return;
      }
      await ensureChunkTranslations(chunkIndex);
    },
    [document, pages.length, pageToChunkIndex, ensureChunkTranslations]
  );

  useEffect(() => {
    if (!pages.length) {
      return;
    }
    void ensurePageTranslations(pageIndex);
    const prefetchWindow = readerConfig.translationPrefetchPages;
    for (let offset = 1; offset <= prefetchWindow; offset += 1) {
      const target = pageIndex + offset;
      if (target < pages.length) {
        void ensurePageTranslations(target);
      }
    }
    const currentChunkIndex = pageToChunkIndex.get(pageIndex);
    if (typeof currentChunkIndex === 'number') {
      const currentChunk = chunks[currentChunkIndex];
      if (currentChunk) {
        const pagesRemaining = currentChunk.endPage - pageIndex;
        if (pagesRemaining <= chunkPrefetchThreshold) {
          const nextChunkIndex = currentChunkIndex + 1;
          if (nextChunkIndex < chunks.length) {
            void ensureChunkTranslations(nextChunkIndex);
          }
        }
      }
    }
  }, [
    pageIndex,
    pages.length,
    ensurePageTranslations,
    pageToChunkIndex,
    chunks,
    chunkPrefetchThreshold,
    ensureChunkTranslations,
  ]);

  const handleToggleSentenceTranslation = async (sentence: Sentence) => {
    const willOpen = !openSentenceTranslations[sentence.index];
    setOpenSentenceTranslations((prev) => ({ ...prev, [sentence.index]: willOpen }));
    if (!willOpen) {
      return;
    }
    const chunkIndex = sentenceToChunkIndex.get(sentence.index);
    if (typeof chunkIndex === 'number') {
      await ensureChunkTranslations(chunkIndex);
      return;
    }
    const owningPageIndex = sentenceToPageIndex.get(sentence.index);
    if (typeof owningPageIndex === 'number') {
      await ensurePageTranslations(owningPageIndex);
    }
  };

  const getAudioElement = useCallback(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    if (!audioRef.current) {
      const element = new Audio();
      element.preload = 'auto';
      audioRef.current = element;
    }
    return audioRef.current;
  }, []);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
      }
      playingRef.current = false;
    };
  }, []);

  const playSentence = useCallback(
    async (index: number, sentence: Sentence) => {
      setActiveSentence(index);
      const provider = getTtsProvider(ACTIVE_TTS_PROVIDER);
      const result = await provider.speakSentence(sentence.text_raw, 'ja');
      const url = await provider.getAudioUrl(result.audioId);
      const audio = getAudioElement();
      if (!audio) {
        return false;
      }

      audio.pause();
      audio.currentTime = 0;
      audio.src = url;

      return await new Promise<boolean>((resolve) => {
        const handleEnded = () => {
          audio.removeEventListener('ended', handleEnded);
          audio.removeEventListener('error', handleError);
          resolve(true);
        };
        const handleError = (event: Event) => {
          console.error('Failed to play sentence audio', event);
          audio.removeEventListener('ended', handleEnded);
          audio.removeEventListener('error', handleError);
          resolve(false);
        };

        audio.addEventListener('ended', handleEnded, { once: true });
        audio.addEventListener('error', handleError, { once: true });

        const playPromise = audio.play();
        if (playPromise) {
          void playPromise.catch((error) => {
            console.error('Audio play rejected', error);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('error', handleError);
            resolve(false);
          });
        } else {
          resolve(false);
        }
      });
    },
    [getAudioElement]
  );

  const handleSentencePlayPause = useCallback(async (sentence: Sentence) => {
    void logReaderEvent('ReaderView', 'sentence_button_clicked', {
      sentenceIndex: sentence.index,
      sentenceText: sentence.text_raw.substring(0, 100),
      currentPlayingSentence,
      hasPageAudioPlayerRef: !!pageAudioPlayerRef.current,
      pageAudioPlayerIsPlaying: pageAudioPlayerRef.current?.isPlaying() || false
    });
    
    void logAudioDebug('sentence_button_clicked', {
      sentenceIndex: sentence.index,
      currentPlayingSentence,
      hasPageAudioPlayerRef: !!pageAudioPlayerRef.current
    });
    
    try {
      if (pageAudioPlayerRef.current) {
        // Find the page-relative index for this sentence
        const pageRelativeIndex = currentPageSentences.findIndex(s => s.index === sentence.index);
        
        if (pageRelativeIndex === -1) {
          void logReaderEvent('ReaderView', 'sentence_not_on_current_page', { 
            sentenceIndex: sentence.index,
            currentPageSentences: currentPageSentences.map(s => s.index)
          });
          return;
        }
        
        // If this sentence is currently playing, pause the audio
        if (currentPlayingSentence === sentence.index && pageAudioPlayerRef.current.isPlaying()) {
          void logReaderEvent('ReaderView', 'pausing_current_sentence', { 
            sentenceIndex: sentence.index,
            pageRelativeIndex 
          });
          void logAudioDebug('pausing_current_sentence', { 
            sentenceIndex: sentence.index,
            pageRelativeIndex 
          });
          pageAudioPlayerRef.current.pause();
        } else {
          void logReaderEvent('ReaderView', 'jumping_to_sentence', { 
            sentenceIndex: sentence.index,
            pageRelativeIndex,
            fromSentence: currentPlayingSentence 
          });
          void logAudioDebug('jumping_to_sentence', { 
            sentenceIndex: sentence.index,
            pageRelativeIndex 
          });
          // Jump to this sentence using page-relative index
          await pageAudioPlayerRef.current.jumpToSentence(pageRelativeIndex);
        }
        setActiveSentence(sentence.index);
      } else {
        void logReaderEvent('ReaderView', 'fallback_sentence_play', { 
          sentenceIndex: sentence.index,
          reason: 'no_page_audio_player_ref'
        });
        void logAudioDebug('fallback_sentence_play', { sentenceIndex: sentence.index });
        // Fallback to individual sentence play only if page audio player unavailable
        await playSentence(sentence.index, sentence);
      }
    } catch (error) {
      void logReaderEvent('ReaderView', 'sentence_play_error', { 
        sentenceIndex: sentence.index, 
        error: error instanceof Error ? error.message : String(error) 
      });
      void logAudioDebug('sentence_play_error', { 
        sentenceIndex: sentence.index, 
        error: error instanceof Error ? error.message : String(error) 
      });
      console.error('Failed to play/pause sentence:', error);
      // Fallback to individual sentence play
      await playSentence(sentence.index, sentence);
    }
  }, [playSentence, currentPlayingSentence]);

  if (!document) {
    void logReaderEvent('ReaderView', 'document_not_found', { 
      documentId, 
      documentsCount: documents.length,
      loading 
    });
    return <p className="p-6 text-sm text-neutral-500">Loading document…</p>;
  }

  const includeSentenceSpacing = document.lang_source === 'en';
  const currentChunkIndex = pageToChunkIndex.get(pageIndex);
  const isCurrentPageLoading =
    typeof currentChunkIndex === 'number' ? loadingChunks[currentChunkIndex] ?? false : false;
  const canGoPrev = pageIndex > 0;
  const canGoNext = pageIndex < totalPages - 1;

  void logReaderEvent('ReaderView', 'rendering', {
    documentId,
    documentTitle: document.title,
    pageIndex,
    totalPages,
    currentPageSentenceCount: currentPageSentences.length,
    canGoPrev,
    canGoNext,
    isCurrentPageLoading,
    activeSentence,
    currentPlayingSentence
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <h1 className="text-2xl font-semibold">{document.title}</h1>
            <p className="text-xs text-neutral-500">{sentenceList.length} sentences</p>
          </div>
        </div>
        
        {/* Page Audio Player */}
        <PageAudioPlayer
          ref={pageAudioPlayerRef}
          documentId={documentId}
          pageIndex={pageIndex}
          sentences={currentPageSentences}
          onCurrentSentenceChange={(sentenceIndex) => {
            void logReaderEvent('ReaderView', 'current_sentence_changed', {
              previousSentence: currentPlayingSentence,
              newSentence: sentenceIndex,
              pageIndex,
              timestamp: Date.now()
            });
            setCurrentPlayingSentence(sentenceIndex);
          }}
        />
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <button
          type="button"
          className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-primary dark:hover:text-primary dark:disabled:border-neutral-800 dark:disabled:text-neutral-600"
          onClick={() => setPageIndex((prev) => Math.max(prev - 1, 0))}
          disabled={!canGoPrev}
        >
          Previous
        </button>
        <div className="flex flex-col text-center sm:flex-row sm:items-center sm:gap-2">
          <span className="font-medium">Page {totalPages ? pageIndex + 1 : 0}</span>
          <span className="text-neutral-500 dark:text-neutral-400">of {totalPages}</span>
          {isCurrentPageLoading && <span className="text-xs text-primary">Translating…</span>}
        </div>
        <button
          type="button"
          className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-primary dark:hover:text-primary dark:disabled:border-neutral-800 dark:disabled:text-neutral-600"
          onClick={() => setPageIndex((prev) => Math.min(prev + 1, totalPages - 1))}
          disabled={!canGoNext}
        >
          Next
        </button>
      </div>
      <section className="space-y-6">
        {currentPage.map((paragraph, paragraphIndex) => (
          <article
            key={`paragraph-${paragraphIndex}`}
            className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition-colors dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="text-lg leading-relaxed">
              {paragraph.map((sentence, sentenceIndex) => {
                const isActive = activeSentence === sentence.index;
                const isCurrentlyPlaying = currentPlayingSentence === sentence.index;
                const isTranslationOpen = openSentenceTranslations[sentence.index];
                const owningPageIndex = sentenceToPageIndex.get(sentence.index);
                const sentenceChunkIndex = sentenceToChunkIndex.get(sentence.index);
                const fallbackChunkIndex =
                  typeof owningPageIndex === 'number'
                    ? pageToChunkIndex.get(owningPageIndex)
                    : undefined;
                const pageIsLoading =
                  typeof sentenceChunkIndex === 'number'
                    ? loadingChunks[sentenceChunkIndex] ?? false
                    : typeof fallbackChunkIndex === 'number'
                    ? loadingChunks[fallbackChunkIndex] ?? false
                    : false;
                const translationText = sentenceTranslations[sentence.index];
                return (
                  <span key={sentence.id} className="inline-block align-baseline">
                    <span className="inline-flex items-center gap-2 align-baseline">
                      <button
                        type="button"
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
                          isCurrentlyPlaying
                            ? 'border-green-400 bg-green-50 text-green-700 dark:border-green-500 dark:bg-green-900/30 dark:text-green-300'
                            : 'border-neutral-300 text-neutral-700 hover:border-primary hover:text-primary dark:border-neutral-700 dark:text-neutral-200'
                        }`}
                        onClick={() => void handleSentencePlayPause(sentence)}
                        aria-label={`Jump to sentence ${sentence.index + 1}`}
                      >
                        {isCurrentlyPlaying ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </button>
                      <span
                        className={`inline-block rounded px-1 py-0.5 transition-colors ${
                          isCurrentlyPlaying
                            ? 'bg-green-100 ring-2 ring-green-400 dark:bg-green-900/30 dark:ring-green-500'
                            : isActive
                            ? 'bg-primary/10 ring-1 ring-primary/40 dark:bg-primary/20'
                            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        }`}
                      >
                        <TouchSelectableText
                          text={sentence.text_raw}
                          documentId={document.id}
                          direction={direction}
                          className="text-lg leading-relaxed"
                        />
                      </span>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 hover:border-primary hover:text-primary dark:border-neutral-700 dark:text-neutral-200"
                        onClick={() => void handleToggleSentenceTranslation(sentence)}
                        aria-label={`Toggle translation for sentence ${sentence.index + 1}`}
                      >
                        <Ellipsis className="h-4 w-4" />
                      </button>
                    </span>
                    {isTranslationOpen && (
                      <span className="mt-2 block rounded-md bg-neutral-100 p-3 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                        {translationText ?? (pageIsLoading ? 'Translating…' : 'Translation unavailable')}
                      </span>
                    )}
                    {includeSentenceSpacing && sentenceIndex < paragraph.length - 1 && <span> </span>}
                  </span>
                );
              })}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
