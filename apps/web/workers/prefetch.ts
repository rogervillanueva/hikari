import { getTranslationProvider } from '@/providers/translation/mock';
import { ACTIVE_PROVIDER } from '@/lib/config';

export async function prefetchWindow(sentences: string[]) {
  const provider = getTranslationProvider(ACTIVE_PROVIDER);
  console.info('[prefetch] translating window', sentences.length);
  return provider.translateSentences(sentences, 'ja', 'en');
}
