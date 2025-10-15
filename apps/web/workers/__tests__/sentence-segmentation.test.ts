import { describe, expect, it } from 'vitest';
import { splitIntoSentences } from '../sentence-segmentation';

describe('splitIntoSentences', () => {
  it('splits paragraphs without punctuation on line breaks', () => {
    const text = `Shopping list\nMilk and eggs\nRemember the bread`;
    expect(splitIntoSentences(text)).toEqual([
      'Shopping list',
      'Milk and eggs',
      'Remember the bread',
    ]);
  });

  it('keeps quoted dialogue intact', () => {
    const text = `"Where are you going?" she asked.\n"Home," he replied.`;
    expect(splitIntoSentences(text)).toEqual([
      '"Where are you going?" she asked.',
      '"Home," he replied.',
    ]);
  });

  it('respects ellipses as sentence terminators', () => {
    const text = 'I thought about it... but decided to stay.';
    expect(splitIntoSentences(text)).toEqual([
      'I thought about it... but decided to stay.',
    ]);
  });

  it('avoids splitting within abbreviations', () => {
    const text = 'We met Dr. Smith in the U.S. Embassy. It was formal.';
    expect(splitIntoSentences(text)).toEqual([
      'We met Dr. Smith in the U.S. Embassy.',
      'It was formal.',
    ]);
  });
});
