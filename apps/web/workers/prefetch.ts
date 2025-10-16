import { translationEnv } from '@/config/env';
import { readerConfig } from '@/config/reader';

export async function prefetchWindow(sentences: string[]) {
  const providerName = translationEnv.defaultProvider;
  console.info('[prefetch] translating window', sentences.length);
  const instruction = readerConfig.translationInstruction?.trim();
  const payloadSentences = instruction ? [instruction, ...sentences] : sentences;
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sentences: payloadSentences,
      src: 'ja',
      tgt: 'en',
      documentId: 'prefetch',
      provider: providerName,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Prefetch translation failed: ${response.status} ${errorText}`);
  }
  const payload = (await response.json()) as { translations: string[] };
  const translations = [...payload.translations];
  if (instruction) {
    translations.shift();
  }
  return translations;
}
