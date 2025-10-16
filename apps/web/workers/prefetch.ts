import { translationEnv } from '@/config/env';

export async function prefetchWindow(sentences: string[]) {
  const providerName = translationEnv.defaultProvider;
  console.info('[prefetch] translating window', sentences.length);
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sentences,
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
  return payload.translations;
}
