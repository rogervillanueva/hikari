import type { PitchInfo, Token } from "@/lib/types";
import type { TranslationDirection } from "../translation/base";

export interface DefinitionExample {
  jp: string;
  en?: string;
}

export interface Definition {
  term: string;
  baseForm?: string;
  reading?: string;
  pronunciation?: string;
  senses: string[];
  partOfSpeech?: string[];
  notes?: string[];
  conjugation?: {
    form?: string;
    description?: string;
    type?: string;
  };
  isTransitive?: boolean | null;
  pitch?: PitchInfo;
  audio?: {
    text?: string;
    url?: string;
    provider?: string;
  };
  examples?: DefinitionExample[];
  provider: string;
}

export interface DictionaryLookupOptions {
  token?: Token;
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
