export interface TranslationEstimate {
  cents: number;
  reason: string;
}

export interface TranslationProvider {
  id: string;
  label: string;
  translateSentences(
    sentences: string[],
    src: 'ja' | 'en',
    tgt: 'en' | 'ja',
    opts?: { formality?: string }
  ): Promise<string[]>;
  estimateCost(chars: number): TranslationEstimate | null;
}
