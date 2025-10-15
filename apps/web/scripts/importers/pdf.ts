import { splitIntoSentences } from '../../workers/sentence-segmentation';

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfSentence {
  pageNumber: number;
  index: number;
  text: string;
}

export function importPdf(pages: PdfPage[]): PdfSentence[] {
  return pages.flatMap((page) => {
    const sentences = splitIntoSentences(page.text);
    return sentences.map((sentence, index) => ({
      pageNumber: page.pageNumber,
      index,
      text: sentence,
    }));
  });
}
