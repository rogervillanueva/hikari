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
};
