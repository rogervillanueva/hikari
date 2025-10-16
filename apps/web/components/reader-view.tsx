'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ellipsis, Pause, Play, Volume2 } from 'lucide-react';
import {
  ACTIVE_DICTIONARY_PROVIDER,
  ACTIVE_TRANSLATION_PROVIDER,
  ACTIVE_TTS_PROVIDER,
} from '@/lib/config';
import { readerConfig } from '@/config/reader';
import { useDocumentsStore } from '@/store/documents';
import { getDictionaryProvider } from '@/providers/dictionary/mock';
import { getTtsProvider } from '@/providers/tts';
import type { Definition } from '@/providers/dictionary/types';
import type { Sentence, Token } from '@/lib/types';
import type { TranslationDirection } from '@/providers/translation/base';
import { translateSentences } from '@/utils/translateSentences';
import {
  tokenizeJapanese,
  subscribeToMorphologyDiagnostics,
  type MorphologyDiagnostic,
} from '@/workers/tokenize-ja';

const JAPANESE_CHAR_REGEX = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u;

interface ReaderViewProps {
  documentId: string;
}

type QueuedMorphologyDiagnostic = MorphologyDiagnostic & { id: number };

export function ReaderView({ documentId }: ReaderViewProps) {
  const router = useRouter();
  const documents = useDocumentsStore((state) => state.documents);
  const sentencesByDoc = useDocumentsStore((state) => state.sentences);
  const loadDocuments = useDocumentsStore((state) => state.loadDocuments);
  const setSentenceTokens = useDocumentsStore((state) => state.setSentenceTokens);
  const [activeSentence, setActiveSentence] = useState<number | null>(null);
  const playingRef = useRef(false);
  const [sentenceTranslations, setSentenceTranslations] = useState<Record<number, string>>({});
  const [openSentenceTranslations, setOpenSentenceTranslations] = useState<Record<number, boolean>>({});
  const [chunkTranslations, setChunkTranslations] = useState<Record<number, Record<string, string>>>({});
  const [loadingChunks, setLoadingChunks] = useState<Record<number, boolean>>({});
  const [wordPopup, setWordPopup] = useState<{
    sentence: Sentence;
    token: Token;
    definition?: Definition;
  } | null>(null);
  const [tokenizingSentences, setTokenizingSentences] = useState<Record<string, boolean>>({});
  const [pageIndex, setPageIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [morphologyDiagnostics, setMorphologyDiagnostics] = useState<QueuedMorphologyDiagnostic[]>([]);
  const diagnosticsIdRef = useRef(0);

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
    setTokenizingSentences({});
    setWordPopup(null);
  }, [documentId]);

  useEffect(() => {
    const unsubscribe = subscribeToMorphologyDiagnostics((diagnostic) => {
      setMorphologyDiagnostics((prev) => {
        if (prev.some((item) => item.level === diagnostic.level && item.message === diagnostic.message)) {
          return prev;
        }
        diagnosticsIdRef.current += 1;
        return [...prev, { ...diagnostic, id: diagnosticsIdRef.current }];
      });
    });
    return unsubscribe;
  }, [subscribeToMorphologyDiagnostics]);

  const dismissMorphologyDiagnostic = useCallback((id: number) => {
    setMorphologyDiagnostics((prev) => prev.filter((item) => item.id !== id));
  }, []);

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

  useEffect(() => {
    if (!currentPage.length) {
      return;
    }
    const pending = new Set(Object.keys(tokenizingSentences));
    const sentencesNeedingTokens = currentPage
      .flat()
      .filter((sentence) => {
        if (pending.has(sentence.id)) {
          return false;
        }
        const tokens = sentence.tokens ?? [];
        if (!tokens.length) {
          return true;
        }
        return tokensLookLikePerCharacterSegmentation(tokens, sentence.text_raw);
      });
    if (!sentencesNeedingTokens.length) {
      return;
    }
    sentencesNeedingTokens.forEach((sentence) => {
      setTokenizingSentences((prev) => ({ ...prev, [sentence.id]: true }));
      void tokenizeJapanese({ text: sentence.text_raw })
        .then(({ tokens }) => {
          const enriched: Token[] = tokens.map((token, index) => ({
            id: `${sentence.id}-${index}`,
            sentenceId: sentence.id,
            index,
            surface: token.surface,
            base: token.base ?? token.surface,
            reading: token.reading,
            pos: token.pos,
            features: token.features,
            conjugation: token.conjugation,
            pitch: token.pitch,
            isWordLike: token.isWordLike ?? /\S/u.test(token.surface),
          }));
          return setSentenceTokens(sentence.documentId, sentence.id, enriched);
        })
        .catch((error) => {
          console.error('[reader] Failed to tokenize sentence', sentence.id, error);
        })
        .finally(() => {
          setTokenizingSentences((prev) => {
            const { [sentence.id]: _omitted, ...rest } = prev;
            return rest;
          });
        });
    });
  }, [currentPage, setSentenceTokens, tokenizingSentences]);

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
      const result = await provider.speakSentence(sentence.text_raw, sourceLanguage);
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
    [getAudioElement, sourceLanguage]
  );

  const playWordAudio = useCallback(
    async (token: Token, definition?: Definition) => {
      const spokenText = definition?.audio?.text ?? token.surface;
      if (!spokenText?.trim()) {
        return false;
      }
      const audio = getAudioElement();
      if (!audio) {
        return false;
      }
      try {
        if (definition?.audio?.url) {
          audio.pause();
          audio.currentTime = 0;
          audio.src = definition.audio.url;
          const playPromise = audio.play();
          if (playPromise) {
            await playPromise;
          }
          return true;
        }
        const provider = getTtsProvider(ACTIVE_TTS_PROVIDER);
        const result = await provider.speakSentence(spokenText, sourceLanguage);
        const url = await provider.getAudioUrl(result.audioId);
        audio.pause();
        audio.currentTime = 0;
        audio.src = url;
        const playPromise = audio.play();
        if (playPromise) {
          await playPromise;
        }
        return true;
      } catch (error) {
        console.error('Failed to play word audio', error);
        return false;
      }
    },
    [getAudioElement, sourceLanguage]
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

  const handleWordClick = async (sentence: Sentence, token: Token) => {
    if (!token.isWordLike) {
      return;
    }
    const dictionary = getDictionaryProvider(ACTIVE_DICTIONARY_PROVIDER);
    const lookupTerm = token.base ?? token.surface;
    let definitions: Definition[] = [];
    try {
      definitions = await dictionary.lookup(lookupTerm, sourceLanguage, {
        sentence: sentence.text_raw,
        documentId: sentence.documentId,
        direction,
        providerName: ACTIVE_TRANSLATION_PROVIDER,
        token,
      });
    } catch (error) {
      console.error('Dictionary lookup failed', error);
    }
    const topDefinition = definitions[0] ?? {
      term: lookupTerm,
      baseForm: token.base ?? token.surface,
      reading: token.reading,
      senses: [lookupTerm],
      partOfSpeech: token.features?.length
        ? token.features
        : token.pos
        ? [token.pos]
        : undefined,
      conjugation: token.conjugation,
      pitch: token.pitch,
      provider: ACTIVE_DICTIONARY_PROVIDER,
    };
    setWordPopup({
      sentence,
      token,
      definition: topDefinition,
    });
  };

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
    <>
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
            <div className="text-lg leading-relaxed">
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
                        className={`inline-flex flex-wrap items-baseline rounded px-1 py-0.5 transition-colors ${
                          isActive
                            ? 'bg-primary/10 ring-1 ring-primary/40 dark:bg-primary/20'
                            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        }`}
                      >
                        {(() => {
                          const tokensToRender: Token[] = sentence.tokens?.length
                            ? sentence.tokens
                            : [
                                {
                                  id: `${sentence.id}-fallback`,
                                  sentenceId: sentence.id,
                                  index: 0,
                                  surface: sentence.text_raw,
                                  isWordLike: true,
                                },
                              ];
                          const isJapaneseSentence = JAPANESE_CHAR_REGEX.test(
                            sentence.text_raw ?? ''
                          );
                          return tokensToRender.map((token) => {
                            const surface = token.surface ?? '';
                            if (!token.isWordLike) {
                              if (isJapaneseSentence && surface.trim().length === 0) {
                                return null;
                              }
                              return (
                                <span key={token.id} className="whitespace-pre">
                                  {surface}
                                </span>
                              );
                            }
                            const tooltipParts = [
                              token.base && token.base !== surface ? `Base: ${token.base}` : null,
                              token.reading ? `Reading: ${token.reading}` : null,
                              token.pos ? token.pos : null,
                            ].filter(Boolean);
                            return (
                              <button
                                key={token.id}
                                type="button"
                                className="relative inline-flex items-center rounded py-0.5 text-left leading-tight transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:bg-primary/20"
                                onClick={() => void handleWordClick(sentence, token)}
                                title={tooltipParts.length ? tooltipParts.join(' • ') : undefined}
                              >
                                {surface}
                              </button>
                            );
                          });
                        })()}
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
      {wordPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
          {(() => {
            const { token, definition } = wordPopup;
            const baseForm = definition?.baseForm ?? token.base ?? token.surface;
            const reading = definition?.reading ?? token.reading;
            const senses = definition?.senses?.length ? definition.senses : [baseForm];
            const partOfSpeech = definition?.partOfSpeech ?? (token.pos ? [token.pos] : undefined);
            const conjugationForm = definition?.conjugation?.form ?? token.conjugation?.form;
            const conjugationDescription =
              definition?.conjugation?.description ?? token.conjugation?.description;
            const conjugationType = definition?.conjugation?.type ?? token.conjugation?.type;
            const pitchInfo = definition?.pitch ?? token.pitch;
            const notes = definition?.notes ?? [];
            const featureTags = Array.from(
              new Set(
                [
                  ...(partOfSpeech ?? []),
                  ...((token.features ?? []).filter(Boolean) as string[]),
                ].filter(Boolean)
              )
            );
            const normalizedSurface = token.surface?.trim() ?? '';
            const normalizedBaseForm = typeof baseForm === 'string' ? baseForm.trim() : '';
            const normalizedConjugationForm =
              typeof conjugationForm === 'string' ? conjugationForm.trim() : '';
            const showCurrentForm =
              normalizedSurface.length > 0 &&
              normalizedBaseForm.length > 0 &&
              normalizedSurface !== normalizedBaseForm;
            const showConjugationDetails = Boolean(
              (normalizedConjugationForm && normalizedConjugationForm.toLowerCase() !== 'dictionary') ||
                conjugationType ||
                conjugationDescription
            );
            return (
              <div className="w-full max-w-md rounded-lg border border-neutral-300 bg-white p-4 shadow-lg dark:border-neutral-700 dark:bg-neutral-950">
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {baseForm}
                </h2>
                {reading && (
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{reading}</p>
                )}
                {featureTags.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {featureTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {pitchInfo ? (
                  <p className="mt-2 text-xs uppercase tracking-wide text-neutral-400">
                    Pitch: {pitchInfo.pattern}
                    {pitchInfo.accents?.length ? ` (accent at ${pitchInfo.accents.join(', ')})` : ''}
                  </p>
                ) : null}
                <div className="mt-3 space-y-3 text-neutral-800 dark:text-neutral-100">
                  {(showCurrentForm || showConjugationDetails) && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-neutral-400">Current form</p>
                      {showCurrentForm && (
                        <p className="text-base font-medium">{token.surface}</p>
                      )}
                      {showConjugationDetails && (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                          {[conjugationType, normalizedConjugationForm, conjugationDescription]
                            .filter((value) =>
                              typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
                            )
                            .join(' • ')}
                        </p>
                      )}
                    </div>
                  )}
                  <div>
                    <p className="text-xs uppercase tracking-wide text-neutral-400">Definition</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-200">
                      {senses.map((sense, index) => (
                        <li key={`${token.id}-sense-${index}`}>{sense}</li>
                      ))}
                    </ul>
                  </div>
                  {notes.length ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-neutral-400">Notes</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
                        {notes.map((note, index) => (
                          <li key={`${token.id}-note-${index}`}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <p className="mt-4 text-xs text-neutral-500">
                  Dictionary provider: {definition?.provider ?? ACTIVE_DICTIONARY_PROVIDER}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-primary hover:text-primary dark:border-neutral-700 dark:text-neutral-200"
                    onClick={() => void playWordAudio(token, definition)}
                  >
                    <Volume2 className="h-4 w-4" /> Play audio
                  </button>
                  <button
                    className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white"
                    onClick={() => setWordPopup(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
      </div>
      {morphologyDiagnostics.length > 0 && (
        <div className="fixed right-4 top-4 z-50 flex max-w-sm flex-col gap-3">
          {morphologyDiagnostics.map((diagnostic) => {
            const toneClasses =
              diagnostic.level === 'error'
                ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-600/60 dark:bg-red-950/60 dark:text-red-100'
                : diagnostic.level === 'warning'
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/60 dark:bg-amber-950/50 dark:text-amber-100'
                : 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-500/60 dark:bg-blue-950/50 dark:text-blue-100';
            return (
              <div
                key={diagnostic.id}
                className={`relative overflow-hidden rounded-md border p-3 shadow-lg transition-all ${toneClasses}`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1 text-sm">
                    <p className="font-medium">
                      {diagnostic.message}
                      {diagnostic.source ? ` (${diagnostic.source})` : ''}
                    </p>
                    {diagnostic.help && diagnostic.help.length > 0 && (
                      <ul className="list-inside list-disc space-y-0.5 text-xs opacity-90">
                        {diagnostic.help.map((hint, index) => (
                          <li key={`${diagnostic.id}-hint-${index}`}>{hint}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    className="-m-1 rounded-full p-1 text-xs text-current transition-opacity hover:opacity-70"
                    aria-label="Dismiss morphology warning"
                    onClick={() => dismissMorphologyDiagnostic(diagnostic.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function tokensLookLikePerCharacterSegmentation(tokens: Token[], originalText: string): boolean {
  const surfaces = tokens.map((token) => token.surface?.trim() ?? '').filter((surface) => surface.length > 0);
  if (!surfaces.length) {
    return false;
  }

  const japaneseTokens = surfaces.filter((surface) => JAPANESE_CHAR_REGEX.test(surface));
  if (japaneseTokens.length < 4) {
    return false;
  }

  const lengths = japaneseTokens.map((surface) => Array.from(surface).length);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const averageLength = totalLength / lengths.length;
  const singleCharCount = lengths.filter((length) => length === 1).length;
  const singleCharRatio = singleCharCount / lengths.length;

  if (averageLength > 1.7 && singleCharRatio < 0.6) {
    return false;
  }

  const originalJapaneseLength = Array.from(originalText).filter((char) => JAPANESE_CHAR_REGEX.test(char)).length;
  return originalJapaneseLength >= 6 && singleCharRatio >= 0.4;
}
