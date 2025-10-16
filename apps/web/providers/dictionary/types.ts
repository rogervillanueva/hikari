import type { TranslationDirection } from "../translation/base";

export interface DefinitionExample {
  jp: string;
  en?: string;
}

export interface Definition {
  term: string;
  reading?: string;
  senses: string[];
  examples?: DefinitionExample[];
  provider: string;
}

export interface DictionaryLookupOptions {
  sentence?: string;
  documentId?: string;
  direction?: TranslationDirection;
  providerName?: string;
}

export interface DictionaryProvider {
  id: string;
  label: string;
  lookup(
    term: string,
    lang: "ja" | "en",
    opts?: DictionaryLookupOptions
  ): Promise<Definition[]>;
}
