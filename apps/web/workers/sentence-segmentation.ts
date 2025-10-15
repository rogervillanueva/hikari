export interface SegmentedSentence {
  text: string;
  paragraphIndex: number;
}

export function sentenceSplitter(text: string): SegmentedSentence[] {
  const sentences: SegmentedSentence[] = [];
  const paragraphs = text.split(/\r?\n\s*\r?\n/);

  paragraphs.forEach((rawParagraph, paragraphIndex) => {
    const paragraph = rawParagraph.trim();
    if (!paragraph) {
      return;
    }

    let buffer = '';
    for (const char of paragraph) {
      buffer += char;
      if (/^[。！？!?]$/.test(char)) {
        const sentence = buffer.trim();
        if (sentence.length) {
          sentences.push({ text: sentence, paragraphIndex });
        }
        buffer = '';
      }
    }

    const trailing = buffer.trim();
    if (trailing.length) {
      sentences.push({ text: trailing, paragraphIndex });
    }
  });

  return sentences;
}
