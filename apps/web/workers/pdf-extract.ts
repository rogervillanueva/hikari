export interface PdfExtractRequest {
  data: ArrayBuffer;
}

export interface PdfExtractResponse {
  text: string;
  meta: Record<string, unknown>;
}

export async function extractPdf(_request: PdfExtractRequest): Promise<PdfExtractResponse> {
  console.info('[pdf-extract] stub worker invoked');
  return { text: '', meta: { strategy: 'stub' } };
}
