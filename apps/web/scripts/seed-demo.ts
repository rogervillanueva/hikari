import { splitIntoSentences } from '../workers/sentence-segmentation';

export interface DemoDocument {
  id: string;
  text: string;
}

export interface PersistedSentence {
  documentId: string;
  order: number;
  text: string;
}

export function prepareDemoSentences(documents: DemoDocument[]): PersistedSentence[] {
  return documents.flatMap((doc) => {
    const sentences = splitIntoSentences(doc.text);
    return sentences.map((text, index) => ({
      documentId: doc.id,
      order: index,
      text,
    }));
  });
}

export function seedDemo(documents: DemoDocument[]): PersistedSentence[] {
  return prepareDemoSentences(documents);
}

export default seedDemo;
