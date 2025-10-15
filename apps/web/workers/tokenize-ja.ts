export interface TokenizeRequest {
  text: string;
}

export interface TokenizeResponse {
  tokens: { surface: string }[];
}

export async function tokenizeJapanese({ text }: TokenizeRequest): Promise<TokenizeResponse> {
  console.info('[tokenize-ja] stub tokenization');
  const tokens = text.split(/\s+/).filter(Boolean).map((surface) => ({ surface }));
  return { tokens };
}
