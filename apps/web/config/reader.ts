const parseNumber = (value: string | undefined, fallback: number, minimum: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(parsed, minimum);
};

export const readerConfig = {
  sentencesPerPage: parseNumber(process.env.NEXT_PUBLIC_SENTENCES_PER_PAGE, 12, 1),
  translationPrefetchPages: parseNumber(process.env.NEXT_PUBLIC_TRANSLATION_PREFETCH_PAGES, 1, 0),
  translationChunkCharacterLimit: parseNumber(
    process.env.NEXT_PUBLIC_TRANSLATION_CHUNK_CHAR_LIMIT,
    4200,
    500
  ),
  translationChunkPrefetchThreshold: parseNumber(
    process.env.NEXT_PUBLIC_TRANSLATION_CHUNK_PREFETCH_THRESHOLD,
    1,
    0
  ),
  translationInstruction:
    process.env.NEXT_PUBLIC_TRANSLATION_INSTRUCTION ??
    'Translate the supplied text with full context so that idioms and figures of speech are rendered naturally for native readers (Tokyo-standard Japanese ↔︎ narrative English). Preserve tone, cohesion, and storytelling flow.',
};
