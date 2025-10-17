// Temporary stub for sudachi server
export class SudachiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SudachiUnavailableError';
  }
}

export const tokenizeWithSudachi = async (text: string) => {
  throw new SudachiUnavailableError('Sudachi not available');
};