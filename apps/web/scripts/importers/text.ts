import { splitIntoSentences } from '../../workers/sentence-segmentation';

export interface ImportedSentence {
  text: string;
  index: number;
}

export function importPlainText(text: string): ImportedSentence[] {
  return splitIntoSentences(text).map((sentence, index) => ({
    text: sentence,
    index,
  }));
}
