import { NextResponse } from 'next/server';
import { getTtsProvider } from '@/providers/tts';
import { ACTIVE_TTS_PROVIDER } from '@/lib/config';

export async function POST(request: Request) {
  const body = await request.json();
  const { text, lang = 'ja', voiceId } = body as {
    text: string;
    lang?: 'ja' | 'en';
    voiceId?: string;
  };
  if (!text) {
    return NextResponse.json({ error: 'Text required' }, { status: 400 });
  }
  const provider = getTtsProvider(ACTIVE_TTS_PROVIDER);
  const result = await provider.speakSentence(text, lang, voiceId);
  const url = await provider.getAudioUrl(result.audioId);
  return NextResponse.json({ result, url, provider: provider.id });
}
