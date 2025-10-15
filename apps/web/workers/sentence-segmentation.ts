export function sentenceSplitter(text: string): string[] {
  const sentences: string[] = [];
  let buffer = '';
  for (const char of text) {
    buffer += char;
    if (/^[。！？!?]$/.test(char)) {
      sentences.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim().length) {
    sentences.push(buffer.trim());
  }
  return sentences.filter(Boolean);
}
