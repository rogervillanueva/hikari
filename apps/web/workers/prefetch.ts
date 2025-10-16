import { getTranslationProvider } from '@/providers/translation';
import { translationEnv } from '@/config/env';
import type { TranslationSentence } from '@/providers/translation/base';

export async function prefetchWindow(sentences: string[]) {
  const provider = getTranslationProvider();
  console.info('[prefetch] translating window', sentences.length);
  const requestSentences: TranslationSentence[] = sentences.map((text, index) => ({
    id: `prefetch-${index}`,
    text,
  }));
  const { translations } = await provider.translateBatch({
    sentences: requestSentences,
    direction: 'ja-en',
    documentId: 'prefetch',
    remainingBudgetCents: translationEnv.documentBudgetCents,
  });
  return requestSentences.map((sentence) => {
    const match = translations.find((entry) => entry.id === sentence.id);
    return match?.translatedText ?? '';
  });
}
