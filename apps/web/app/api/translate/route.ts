import { NextResponse } from 'next/server';
import { getTranslationProvider } from '@/providers/translation';
import { translationEnv } from '@/config/env';
import type { TranslationDirection, TranslationSentence } from '@/providers/translation/base';

export async function POST(request: Request) {
  const body = await request.json();
  const { sentences, src = 'ja', tgt = 'en', documentId } = body as {
    sentences: string[];
    src: 'ja' | 'en';
    tgt: 'ja' | 'en';
    documentId?: string;
  };
  if (!Array.isArray(sentences)) {
    return NextResponse.json({ error: 'Sentences array is required' }, { status: 400 });
  }
  const direction: TranslationDirection | undefined =
    src === 'ja' && tgt === 'en' ? 'ja-en' : src === 'en' && tgt === 'ja' ? 'en-ja' : undefined;
  if (!direction) {
    return NextResponse.json({ error: `Unsupported translation direction: ${src}-${tgt}` }, { status: 400 });
  }

  const provider = getTranslationProvider();
  const requestSentences: TranslationSentence[] = sentences.map((text, index) => ({
    id: `api-${index}`,
    text,
  }));

  const { translations } = await provider.translateBatch({
    sentences: requestSentences,
    direction,
    documentId: documentId ?? 'api-request',
    remainingBudgetCents: translationEnv.documentBudgetCents,
  });

  const orderedTranslations = requestSentences.map((sentence) => {
    const match = translations.find((entry) => entry.id === sentence.id);
    return match?.translatedText ?? '';
  });

  return NextResponse.json({ translations: orderedTranslations, provider: provider.name });
}
