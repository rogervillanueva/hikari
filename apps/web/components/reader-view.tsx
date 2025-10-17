'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { Ellipsis, Pause, Play } from 'lucide-react';
import { ACTIVE_TRANSLATION_PROVIDER, ACTIVE_TTS_PROVIDER } from '@/lib/config';
import { readerConfig } from '@/config/reader';
import { useDocumentsStore } from '@/store/documents';
import { getTtsProvider } from '@/providers/tts';
import type { Sentence } from '@/lib/types';
import type { TranslationDirection } from '@/providers/translation/base';
import { translateSentences } from '@/utils/translateSentences';

interface ReaderViewProps {
  documentId: string;
}

export function ReaderView({ documentId }: ReaderViewProps) {
  const router = useRouter();
  const documents = useDocumentsStore((state) => state.documents);
  const sentencesByDoc = useDocumentsStore((state) => state.sentences);
  const loadDocuments = useDocumentsStore((state) => state.loadDocuments);
  const [activeSentence, setActiveSentence] = useState<number | null>(null);
  const playingRef = useRef(false);
  const [sentenceTranslations, setSentenceTranslations] = useState<Record<number, string>>({});
  const [openSentenceTranslations, setOpenSentenceTranslations] = useState<Record<number, boolean>>({});
  const [chunkTranslations, setChunkTranslations] = useState<Record<number, Record<string, string>>>({});
  const [loadingChunks, setLoadingChunks] = useState<Record<number, boolean>>({});
  const [selectionPopup, setSelectionPopup] = useState<{
    sentence: Sentence;
    text: string;
    translation: string;
    isLoading: boolean;
  } | null>(null);
  type ActiveSelection = {
    sentence: Sentence;
    start: number;
    end: number;
    pointerId: number;
  };
  type CompletedSelection = {
    sentence: Sentence;
    start: number;
    end: number;
    text: string;
  };
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);
  const [completedSelection, setCompletedSelection] = useState<CompletedSelection | null>(null);
  const activeSelectionRef = useRef<ActiveSelection | null>(null);
  const selectionTokenRef = useRef<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const document = useMemo(
    () => documents.find((doc) => doc.id === documentId),
    [documents, documentId]
  );
  const sentenceList = sentencesByDoc[documentId] ?? [];
  const sentencesPerPage = readerConfig.sentencesPerPage;
  const translationInstruction = readerConfig.translationInstruction;
  const chunkCharacterLimit = readerConfig.translationChunkCharacterLimit;
  const chunkPrefetchThreshold = readerConfig.translationChunkPrefetchThreshold;

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!document && documents.length) {
      router.replace('/documents');
    }
  }, [document, documents.length, router]);

  useEffect(() => {
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

    return result.length ? result : [paragraphs];
  }, [paragraphs, sentencesPerPage]);

  const totalPages = pages.length;
  const currentPage = pages[pageIndex] ?? [];

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
  const targetLanguage = direction === 'ja-en' ? 'en' : 'ja';

  useEffect(() => {
    activeSelectionRef.current = activeSelection;
  }, [activeSelection]);

  const translateSelection = useCallback(
    async (text: string, sentence: Sentence, selectionKey: string) => {
      if (!document) {
        return;
      }
      if (selectionTokenRef.current !== selectionKey) {
        return;
      }
      setSelectionPopup({
        sentence,
        text,
        translation: 'Translating…',
        isLoading: true,
      });
      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sentences: [text],
            src: sourceLanguage,
            tgt: targetLanguage,
            documentId: document.id,
            provider: ACTIVE_TRANSLATION_PROVIDER,
          }),
        });
        if (!response.ok) {
          throw new Error(`Translation request failed: ${response.status}`);
        }
        const data: { translations?: string[] } = await response.json();
        const translated = data.translations?.[0]?.trim();
        if (selectionTokenRef.current !== selectionKey) {
          return;
        }
        setSelectionPopup({
          sentence,
          text,
          translation: translated && translated.length ? translated : 'Translation unavailable',
          isLoading: false,
        });
      } catch (error) {
        console.error('Failed to translate selection', error);
        if (selectionTokenRef.current !== selectionKey) {
          return;
        }
        setSelectionPopup({
          sentence,
          text,
          translation: 'Translation unavailable',
          isLoading: false,
        });
      }
    },
    [document, sourceLanguage, targetLanguage]
  );

  const finalizeSelection = useCallback(
    (event?: PointerEvent) => {
      const selection = activeSelectionRef.current;
      if (!selection) {
        return;
      }
      let finalIndex = selection.end;
      if (event) {
        const element = document.elementFromPoint(event.clientX, event.clientY) as
          | HTMLElement
          | null;
        const targetElement = element?.closest<HTMLElement>('[data-char-index]');
        if (
          targetElement?.dataset.charIndex &&
          targetElement.dataset.sentenceIndex === `${selection.sentence.index}`
        ) {
          const parsed = Number(targetElement.dataset.charIndex);
          if (!Number.isNaN(parsed)) {
            finalIndex = parsed;
          }
        }
      }
      const start = Math.min(selection.start, finalIndex);
      const end = Math.max(selection.start, finalIndex);
      const characters = Array.from(selection.sentence.text_raw);
      const text = characters.slice(start, end + 1).join('');
      setActiveSelection(null);
      activeSelectionRef.current = null;
      if (!text.trim()) {
        selectionTokenRef.current = null;
        setCompletedSelection(null);
        return;
      }
      const selectionKey = `${selection.sentence.id}:${start}-${end}`;
      selectionTokenRef.current = selectionKey;
      setCompletedSelection({
        sentence: selection.sentence,
        start,
        end,
        text,
      });
      void translateSelection(text, selection.sentence, selectionKey);
    },
    [translateSelection]
  );

  useEffect(() => {
    if (!activeSelection) {
      return;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const selection = activeSelectionRef.current;
      if (!selection || event.pointerId !== selection.pointerId) {
        return;
      }
      const element = document.elementFromPoint(event.clientX, event.clientY) as
        | HTMLElement
        | null;
      const targetElement = element?.closest<HTMLElement>('[data-char-index]');
      if (
        !targetElement?.dataset.charIndex ||
        targetElement.dataset.sentenceIndex !== `${selection.sentence.index}`
      ) {
        return;
      }
      const parsed = Number(targetElement.dataset.charIndex);
      if (Number.isNaN(parsed)) {
        return;
      }
      setActiveSelection((prev) => {
        if (!prev || prev.pointerId !== event.pointerId || prev.end === parsed) {
          return prev;
        }
        return { ...prev, end: parsed };
      });
      activeSelectionRef.current = {
        ...selection,
        end: parsed,
      };
    };
    const handlePointerUp = (event: PointerEvent) => {
      const selection = activeSelectionRef.current;
      if (!selection || event.pointerId !== selection.pointerId) {
        return;
      }
      finalizeSelection(event);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      const selection = activeSelectionRef.current;
      if (!selection || event.pointerId !== selection.pointerId) {
        return;
      }
      setActiveSelection(null);
      activeSelectionRef.current = null;
      selectionTokenRef.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [activeSelection, finalizeSelection]);

  const handleSelectionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>, sentence: Sentence, charIndex: number) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      setSelectionPopup(null);
      setCompletedSelection(null);
      selectionTokenRef.current = null;
      const boundedIndex = Math.max(
        0,
        Math.min(charIndex, Array.from(sentence.text_raw).length - 1)
      );
      const nextSelection: ActiveSelection = {
        sentence,
        start: boundedIndex,
        end: boundedIndex,
        pointerId: event.pointerId,
      };
      setActiveSelection(nextSelection);
      activeSelectionRef.current = nextSelection;
    },
    []
  );

  const handleCloseSelectionPopup = useCallback(() => {
    setSelectionPopup(null);
    setCompletedSelection(null);
    selectionTokenRef.current = null;
  }, []);

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

  const handleMasterPlay = useCallback(async () => {
    if (playingRef.current) {
      playingRef.current = false;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
      }
      return;
    }
    playingRef.current = true;
    for (let i = activeSentence ?? 0; i < sentenceList.length; i += 1) {
      if (!playingRef.current) break;
      const success = await playSentence(i, sentenceList[i]);
      if (!success) {
        break;
      }
    }
    playingRef.current = false;
  }, [activeSentence, sentenceList, playSentence]);

  if (!document) {
    return <p className="p-6 text-sm text-neutral-500">Loading document…</p>;
  }

  const includeSentenceSpacing = document.lang_source === 'en';
  const currentChunkIndex = pageToChunkIndex.get(pageIndex);
  const isCurrentPageLoading =
    typeof currentChunkIndex === 'number' ? loadingChunks[currentChunkIndex] ?? false : false;
  const canGoPrev = pageIndex > 0;
  const canGoNext = pageIndex < totalPages - 1;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <h1 className="text-2xl font-semibold">{document.title}</h1>
          <p className="text-xs text-neutral-500">{sentenceList.length} sentences</p>
        </div>
        <div className="flex gap-2">
          <button
            className="flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:border-primary dark:border-neutral-700"
            onClick={() => void handleMasterPlay()}
          >
            {playingRef.current ? (
              <>
                <Pause className="h-4 w-4" /> Pause
              </>
            ) : (
              <>
                <Play className="h-4 w-4" /> Master play
              </>
            )}
          </button>
        </div>
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
            <div className="text-lg leading-relaxed whitespace-pre-wrap">
              {paragraph.map((sentence, sentenceIndex) => {
                const isActive = activeSentence === sentence.index;
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
                const activeRange =
                  activeSelection && activeSelection.sentence.index === sentence.index
                    ? {
                        start: Math.min(activeSelection.start, activeSelection.end),
                        end: Math.max(activeSelection.start, activeSelection.end),
                      }
                    : null;
                const completedRange =
                  !activeRange &&
                  completedSelection &&
                  completedSelection.sentence.index === sentence.index
                    ? {
                        start: completedSelection.start,
                        end: completedSelection.end,
                      }
                    : null;
                const characters = Array.from(sentence.text_raw);
                return (
                  <span key={sentence.id} className="inline-block align-baseline">
                    <span className="inline-flex items-center gap-2 align-baseline">
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 hover:border-primary hover:text-primary dark:border-neutral-700 dark:text-neutral-200"
                        onClick={() => void playSentence(sentence.index, sentence)}
                        aria-label={`Play sentence ${sentence.index + 1}`}
                      >
                        <Play className="h-4 w-4" />
                      </button>
                      <span
                        className={`inline-block rounded px-1 py-0.5 transition-colors ${
                          isActive
                            ? 'bg-primary/10 ring-1 ring-primary/40 dark:bg-primary/20'
                            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        }`}
                      >
                        {characters.map((char, charIndex) => {
                          const isInActiveRange =
                            !!activeRange && charIndex >= activeRange.start && charIndex <= activeRange.end;
                          const isInCompletedRange =
                            !activeRange &&
                            !!completedRange &&
                            charIndex >= completedRange.start &&
                            charIndex <= completedRange.end;
                          const isSelected = isInActiveRange || isInCompletedRange;
                          const displayChar = char === ' ' ? ' ' : char;
                          return (
                            <span
                              key={`${sentence.id}-${charIndex}`}
                              data-sentence-index={sentence.index}
                              data-char-index={charIndex}
                              onPointerDown={(event) =>
                                handleSelectionPointerDown(event, sentence, charIndex)
                              }
                              className={`relative inline-block select-none rounded-sm px-0.5 py-0.5 transition-all duration-150 ${
                                isSelected
                                  ? 'bg-primary/10 text-neutral-900 dark:bg-primary/30 dark:text-white -translate-y-0.5'
                                  : ''
                              }`}
                            >
                              {displayChar}
                            </span>
                          );
                        })}
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
      {selectionPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-lg border border-neutral-300 bg-white p-4 shadow-lg dark:border-neutral-700 dark:bg-neutral-950">
            <h2 className="text-lg font-semibold">{selectionPopup.text}</h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              {selectionPopup.translation}
            </p>
            <p className="mt-4 text-xs text-neutral-500">
              Sentence: {selectionPopup.sentence.text_raw}
            </p>
            <button
              className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white"
              onClick={handleCloseSelectionPopup}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
