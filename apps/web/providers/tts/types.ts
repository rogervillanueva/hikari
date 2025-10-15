export interface TtsMark {
  offsetMs: number;
  tag: string;
}

export interface TtsResult {
  audioId: string;
  durationMs: number;
  marks?: TtsMark[];
}

export interface TtsProvider {
  id: string;
  label: string;
  speakSentence(text: string, lang: 'ja' | 'en', voiceId?: string): Promise<TtsResult>;
  getAudioUrl(audioId: string): Promise<string>;
}
