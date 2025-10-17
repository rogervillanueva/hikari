export interface TokenizeRequest {
  text: string;
}

export interface TokenizeResponseToken {
  surface: string;
  reading?: string;
  pronunciation?: string;
  part_of_speech?: string;
  pos_detail_1?: string;
  pos_detail_2?: string;
  pos_detail_3?: string;
  inflection_type?: string;
  inflection_form?: string;
  base_form?: string;
  conjunctions?: string[];
}

export interface TokenizeResponse {
  tokens: TokenizeResponseToken[];
}

export async function tokenizeJapanese({ text }: TokenizeRequest): Promise<TokenizeResponse> {
  console.info('[tokenize-ja] stub tokenization');
  const tokens: TokenizeResponseToken[] = text.split(/\s+/).filter(Boolean).map((surface) => ({ surface }));
  return { tokens };
}
