import { NextResponse } from 'next/server';
import { getTtsProvider } from '@/providers/tts/mock';
import { ACTIVE_PROVIDER } from '@/lib/config';

export async function POST(request: Request) {
  const body = await request.json();
  const { text, lang = 'ja' } = body as { text: string; lang?: 'ja' | 'en' };
  if (!text) {
    return NextResponse.json({ error: 'Text required' }, { status: 400 });
  }
  const provider = getTtsProvider(ACTIVE_PROVIDER);
  const result = await provider.speakSentence(text, lang);
  const url = await provider.getAudioUrl(result.audioId);
  return NextResponse.json({ result, url, provider: provider.id });
}
