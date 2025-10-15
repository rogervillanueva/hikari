'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ellipsis, Play, Pause } from 'lucide-react';
import { ACTIVE_PROVIDER } from '@/lib/config';
import { useDocumentsStore } from '@/store/documents';
import { getDictionaryProvider } from '@/providers/dictionary/mock';
import { getTranslationProvider } from '@/providers/translation/mock';
import { getTtsProvider } from '@/providers/tts';
import type { Sentence } from '@/lib/types';

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
  const [wordPopup, setWordPopup] = useState<{ sentence: Sentence; token: string; definition: string } | null>(null);

  const document = useMemo(() => documents.find((doc) => doc.id === documentId), [documents, documentId]);
  const sentenceList = sentencesByDoc[documentId] ?? [];
  const paragraphs = useMemo(() => {
    if (!sentenceList.length) return [] as Sentence[][];
    const hasParagraphData = sentenceList.some((sentence) => typeof sentence.paragraphIndex === 'number');
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

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!document && documents.length) {
      router.replace('/documents');
    }
  }, [document, documents.length, router]);

  const handleToggleSentenceTranslation = async (sentence: Sentence) => {
    const willOpen = !openSentenceTranslations[sentence.index];
    setOpenSentenceTranslations((prev) => ({ ...prev, [sentence.index]: willOpen }));
    if (!willOpen) {
      return;
    }
    if (sentenceTranslations[sentence.index]) {
      return;
    }
    const provider = getTranslationProvider(ACTIVE_PROVIDER);
    const sourceLanguage = document?.lang_source ?? 'ja';
    const targetLanguage = sourceLanguage === 'ja' ? 'en' : 'ja';
    const options =
      targetLanguage === 'ja'
        ? {
            instructions:
              'Translate the passage into natural, contextually rich Japanese that preserves narrative flow and uses idiomatic expressions appropriate to Tokyo standard Japanese when suitable.',
          }
        : undefined;
    const [translation] = await provider.translateSentences(
      [sentence.text_raw],
      sourceLanguage,
      targetLanguage,
      options
    );
    setSentenceTranslations((prev) => ({ ...prev, [sentence.index]: translation }));
  };

  const playSentence = async (index: number, sentence: Sentence) => {
    setActiveSentence(index);
    const provider = getTtsProvider(ACTIVE_PROVIDER);
    const result = await provider.speakSentence(sentence.text_raw, 'ja');
    const url = await provider.getAudioUrl(result.audioId);
    const audio = new Audio(url);
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => {
        resolve();
      };
    });
  };

  const handleMasterPlay = async () => {
    if (playingRef.current) {
      playingRef.current = false;
      return;
    }
    playingRef.current = true;
    for (let i = activeSentence ?? 0; i < sentenceList.length; i += 1) {
      if (!playingRef.current) break;
      await playSentence(i, sentenceList[i]);
    }
    playingRef.current = false;
  };

  const handleWordClick = async (sentence: Sentence, token: string) => {
    const dictionary = getDictionaryProvider(ACTIVE_PROVIDER);
    const definitions = await dictionary.lookup(token, 'ja', { sentence: sentence.text_raw });
    setWordPopup({ sentence, token, definition: definitions[0]?.senses[0] ?? token });
  };

  if (!document) {
    return <p className="p-6 text-sm text-neutral-500">Loading document…</p>;
  }

  const includeSentenceSpacing = document.lang_source === 'en';

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
      <section className="space-y-6">
        {paragraphs.map((paragraph, paragraphIndex) => (
          <article
            key={`paragraph-${paragraphIndex}`}
            className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition-colors dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="text-lg leading-relaxed">
              {paragraph.map((sentence, sentenceIndex) => {
                const isActive = activeSentence === sentence.index;
                const isTranslationOpen = openSentenceTranslations[sentence.index];
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
                        {sentenceTranslations[sentence.index] ?? 'Translating…'}
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
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{wordPopup.definition}</p>
            <p className="mt-4 text-xs text-neutral-500">Sentence: {wordPopup.sentence.text_raw}</p>
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
