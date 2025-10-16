'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ellipsis, Pause, Play } from 'lucide-react';
import {
  ACTIVE_DICTIONARY_PROVIDER,
  ACTIVE_TRANSLATION_PROVIDER,
  ACTIVE_TTS_PROVIDER,
} from '@/lib/config';
import { readerConfig } from '@/config/reader';
import { useDocumentsStore } from '@/store/documents';
import { getDictionaryProvider } from '@/providers/dictionary/mock';
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
  const [pageTranslations, setPageTranslations] = useState<Record<number, Record<string, string>>>({});
  const [loadingPages, setLoadingPages] = useState<Record<number, boolean>>({});
  const [wordPopup, setWordPopup] = useState<{
    sentence: Sentence;
    token: string;
    translation: string;
    sentenceTranslation?: string;
  } | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const document = useMemo(
    () => documents.find((doc) => doc.id === documentId),
    [documents, documentId]
  );
  const sentenceList = sentencesByDoc[documentId] ?? [];
  const sentencesPerPage = readerConfig.sentencesPerPage;

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
    setPageTranslations({});
    setLoadingPages({});
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

  useEffect(() => {
    if (pageIndex >= totalPages && totalPages > 0) {
      setPageIndex(totalPages - 1);
    }
  }, [pageIndex, totalPages]);

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

  const sourceLanguage = document?.lang_source ?? 'ja';
  const direction: TranslationDirection = sourceLanguage === 'en' ? 'en-ja' : 'ja-en';

  const ensurePageTranslations = useCallback(
    async (targetPage: number) => {
      if (!document) {
        return;
      }
      if (targetPage < 0 || targetPage >= pages.length) {
        return;
      }
      if (pageTranslations[targetPage] || loadingPages[targetPage]) {
        return;
      }

      const page = pages[targetPage];
      const sentencesForPage = page.flat();
      if (!sentencesForPage.length) {
        setPageTranslations((prev) => ({ ...prev, [targetPage]: {} }));
        return;
      }

      setLoadingPages((prev) => ({ ...prev, [targetPage]: true }));
      try {
        const { translations } = await translateSentences({
          sentences: sentencesForPage.map((sentence) => ({
            id: sentence.id,
            text: sentence.text_raw,
          })),
          direction,
          documentId: document.id,
        });

        setPageTranslations((prev) => ({ ...prev, [targetPage]: translations }));
        setSentenceTranslations((prev) => {
          const updates: Record<number, string> = {};
          sentencesForPage.forEach((sentence) => {
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
        console.error('Failed to translate page', error);
        setPageTranslations((prev) => ({ ...prev, [targetPage]: {} }));
      } finally {
        setLoadingPages((prev) => {
          const next = { ...prev };
          delete next[targetPage];
          return next;
        });
      }
    },
    [document, direction, loadingPages, pageTranslations, pages]
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
  }, [pageIndex, pages.length, ensurePageTranslations]);

  const handleToggleSentenceTranslation = async (sentence: Sentence) => {
    const willOpen = !openSentenceTranslations[sentence.index];
    setOpenSentenceTranslations((prev) => ({ ...prev, [sentence.index]: willOpen }));
    if (!willOpen) {
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

  const handleWordClick = async (sentence: Sentence, token: string) => {
    const dictionary = getDictionaryProvider(ACTIVE_DICTIONARY_PROVIDER);
    const definitions = await dictionary.lookup(token, sourceLanguage, {
      sentence: sentence.text_raw,
      documentId: sentence.documentId,
      direction,
      providerName: ACTIVE_TRANSLATION_PROVIDER,
    });
    const topDefinition = definitions[0];
    const cachedSentenceTranslation = sentenceTranslations[sentence.index];
    const sentenceTranslation =
      cachedSentenceTranslation ?? topDefinition?.examples?.[0]?.en ?? undefined;
    setWordPopup({
      sentence,
      token,
      translation: topDefinition?.senses[0] ?? token,
      sentenceTranslation,
    });
  };

  if (!document) {
    return <p className="p-6 text-sm text-neutral-500">Loading document…</p>;
  }

  const includeSentenceSpacing = document.lang_source === 'en';
  const isCurrentPageLoading = loadingPages[pageIndex] ?? false;
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
            <div className="text-lg leading-relaxed">
              {paragraph.map((sentence, sentenceIndex) => {
                const isActive = activeSentence === sentence.index;
                const isTranslationOpen = openSentenceTranslations[sentence.index];
                const owningPageIndex = sentenceToPageIndex.get(sentence.index);
                const pageIsLoading =
                  typeof owningPageIndex === 'number' ? loadingPages[owningPageIndex] : false;
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
                        className={`inline-block rounded px-1 py-0.5 transition-colors ${
                          isActive
                            ? 'bg-primary/10 ring-1 ring-primary/40 dark:bg-primary/20'
                            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        }`}
                      >
                        {sentence.text_raw.split(/(\s+)/).map((token, tokenIndex) => {
                          if (!token.trim()) {
                            return <span key={`${sentence.id}-${tokenIndex}`}>{token}</span>;
                          }
                          return (
                            <button
                              key={`${sentence.id}-${tokenIndex}`}
                              type="button"
                              className="rounded px-1 py-0.5 text-left focus:outline-none focus:ring-1 focus:ring-primary"
                              onClick={() => void handleWordClick(sentence, token)}
                            >
                              {token}
                            </button>
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
      {wordPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-lg border border-neutral-300 bg-white p-4 shadow-lg dark:border-neutral-700 dark:bg-neutral-950">
            <h2 className="text-lg font-semibold">{wordPopup.token}</h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              {wordPopup.translation}
            </p>
            {(() => {
              const sentenceTranslation = wordPopup.sentenceTranslation?.trim();
              const baseTranslation = wordPopup.translation.trim();
              if (!sentenceTranslation) {
                return null;
              }
              if (sentenceTranslation === baseTranslation) {
                return null;
              }
              return (
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                  {sentenceTranslation}
                </p>
              );
            })()}
            <p className="mt-4 text-xs text-neutral-500">
              Sentence: {wordPopup.sentence.text_raw}
            </p>
            <button
              className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white"
              onClick={() => setWordPopup(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
