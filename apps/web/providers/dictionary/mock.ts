'use client';

import { ACTIVE_TRANSLATION_PROVIDER } from '@/lib/config';
import type { TranslationDirection } from '@/providers/translation/base';
import type {
  Definition,
  DictionaryLookupOptions,
  DictionaryProvider,
} from './types';

const directionToLanguages: Record<
  TranslationDirection,
  { src: 'ja' | 'en'; tgt: 'ja' | 'en' }
> = {
  'ja-en': { src: 'ja', tgt: 'en' },
  'en-ja': { src: 'en', tgt: 'ja' },
};

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
  label: 'Translation Lookup',
  async lookup(term, lang, opts: DictionaryLookupOptions = {}) {
    const reading = kanaHeuristic(term);
    const direction: TranslationDirection =
      opts.direction ?? (lang === 'en' ? 'en-ja' : 'ja-en');
    const providerName = opts.providerName ?? ACTIVE_TRANSLATION_PROVIDER;
    const documentId = opts.documentId ?? 'dictionary';
    const sentence = opts.sentence;

    const texts: string[] = [term];
    if (sentence) {
      texts.push(sentence);
    }

    let translations: string[] = [];
    const languages = directionToLanguages[direction];

    try {
      if (!languages) {
        throw new Error(`Unsupported translation direction for dictionary: ${direction}`);
      }
      if (texts.length) {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sentences: texts,
            src: languages.src,
            tgt: languages.tgt,
            documentId,
            provider: providerName,
          }),
        });

        if (!response.ok) {
          throw new Error(`Dictionary translation failed: ${response.status}`);
        }

        const payload = (await response.json()) as { translations?: string[] };
        translations = payload.translations ?? [];
      }
    } catch (error) {
      console.error('[dictionary:mock] lookup failed', error);
      translations = [];
    }

    const [termTranslation, sentenceTranslation] = translations;

    const definition: Definition = {
      term,
      reading,
      senses: [termTranslation || term],
      examples:
        sentence
          ? [
              {
                jp: sentence,
                en: sentenceTranslation,
              },
            ]
          : undefined,
      provider: providerName,
    };

    return [definition];
  },
};

export const dictionaryProviders: Record<string, DictionaryProvider> = {
  mock: mockDictionaryProvider
};

export function getDictionaryProvider(id: string): DictionaryProvider {
  return dictionaryProviders[id] ?? mockDictionaryProvider;
}
