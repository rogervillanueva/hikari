// Temporary stub for kuromoji server
export class KuromojiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KuromojiUnavailableError';
  }
}

export const tokenizeWithKuromoji = async (text: string) => {
  throw new KuromojiUnavailableError('Kuromoji not available');
};