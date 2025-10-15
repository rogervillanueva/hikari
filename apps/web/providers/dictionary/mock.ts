'use client';

import { mockTranslationProvider } from '@/providers/translation/mock';
import type { Definition, DictionaryProvider } from './types';

function kanaHeuristic(term: string): string {
  return term
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code >= 0x30a1 && code <= 0x30f6) {
        return String.fromCharCode(code - 0x60);
      }
      return char;
    })
    .join('');
}

export const mockDictionaryProvider: DictionaryProvider = {
  id: 'mock',
  label: 'Mock Dictionary',
  async lookup(term, _lang, opts) {
    console.info('[dictionary:mock] lookup', { term, opts });
    const translation = await mockTranslationProvider.translateSentences([term], 'ja', 'en');
    const reading = kanaHeuristic(term);
    const sentence = opts?.sentence;
    const definition: Definition = {
      term,
      reading,
      senses: [translation[0] ?? term],
      examples: sentence
        ? [
            {
              jp: sentence,
              en: (await mockTranslationProvider.translateSentences([sentence], 'ja', 'en'))[0]
            }
          ]
        : undefined,
      provider: 'mock'
    };
    return [definition];
  }
};

export const dictionaryProviders: Record<string, DictionaryProvider> = {
  mock: mockDictionaryProvider
};

export function getDictionaryProvider(id: string): DictionaryProvider {
  return dictionaryProviders[id] ?? mockDictionaryProvider;
}
