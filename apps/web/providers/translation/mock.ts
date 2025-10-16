'use client';

import demoEnglish from '@/fixtures/demo-lotr-en.txt';
import type { TranslationEstimate, TranslationProvider } from './types';

const englishSentences = demoEnglish.trim().split(/\r?\n/);

function estimate(chars: number): TranslationEstimate {
  return {
    cents: 0,
    reason: 'Mock provider has no cost'
  };
}

export const mockTranslationProvider: TranslationProvider = {
  id: 'mock',
  label: 'Mock Translation',
  translateSentences: async (sentences, src, _tgt, opts) => {
    console.info('[translation:mock] translating', {
      sentences: sentences.length,
      src,
      instructions: opts?.instructions
    });

    if (src === 'en') {
      return sentences;
    }

    return sentences.map((sentence, index) => {
      const match = englishSentences[index];
      if (match) {
        return match;
      }
      return `「TRANSLATION PENDING」 ${sentence}`;
    });
  },
  estimateCost: (chars) => estimate(chars)
};

export const translationProviders: Record<string, TranslationProvider> = {
  mock: mockTranslationProvider
};

export function getTranslationProvider(id: string): TranslationProvider {
  return translationProviders[id] ?? mockTranslationProvider;
}

export async function translateWithWindow(
  documentId: string,
  sentences: string[],
  providerId: string,
  startIndex: number,
  windowSize: number
) {
  const provider = getTranslationProvider(providerId);
  const window = sentences.slice(startIndex, startIndex + windowSize);
  console.info('[translation:window]', {
    documentId,
    startIndex,
    windowSize,
    strategy: 'windowed'
  });
  return provider.translateSentences(window, 'ja', 'en');
}

export function estimateDocumentCost(chars: number, providerId: string) {
  const provider = getTranslationProvider(providerId);
  return provider.estimateCost(chars);
}
