import { NextResponse } from 'next/server';
import { getTranslationProvider } from '@/providers/translation/mock';
import { ACTIVE_PROVIDER } from '@/lib/config';

export async function POST(request: Request) {
  const body = await request.json();
  const { sentences, src = 'ja', tgt = 'en' } = body as {
    sentences: string[];
    src: 'ja' | 'en';
    tgt: 'ja' | 'en';
  };
  if (!Array.isArray(sentences)) {
    return NextResponse.json({ error: 'Sentences array is required' }, { status: 400 });
  }
  const provider = getTranslationProvider(ACTIVE_PROVIDER);
  const translations = await provider.translateSentences(sentences, src, tgt);
  return NextResponse.json({ translations, provider: provider.id });
}
