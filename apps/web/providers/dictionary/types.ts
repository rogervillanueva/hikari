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

export interface DictionaryProvider {
  id: string;
  label: string;
  lookup(term: string, lang: 'ja', opts?: { sentence?: string }): Promise<Definition[]>;
}
