export type TranslationDirection = "ja-en" | "en-ja";

export interface TranslationSentence {
  id: string;
  text: string;
}

export interface TranslationEstimate {
  /**
   * Estimated number of characters that will be billed by the external API.
   */
  billableCharacters: number;
  /**
   * Estimated cost in cents the provider expects to charge for the request.
   */
  estimatedCostCents: number;
}

export interface TranslationRequestMetadata {
  documentId: string;
  remainingBudgetCents: number;
}

export interface TranslationBatchArgs extends TranslationRequestMetadata {
  sentences: TranslationSentence[];
  direction: TranslationDirection;
  abortSignal?: AbortSignal;
}

export interface TranslationBatchResult {
  translations: Array<{
    id: string;
    translatedText: string;
    detectedSourceLanguage?: string;
  }>;
  consumedBudgetCents: number;
  providerMetadata?: Record<string, unknown>;
}

export interface TranslationProvider {
  readonly name: string;
  /**
   * A short human-friendly label surfaced in the UI.
   */
  readonly label: string;
  /**
   * Rough estimation used to check the document budget before hitting the API.
   */
  estimateCost(input: TranslationSentence[], direction: TranslationDirection): TranslationEstimate;
  translateBatch(args: TranslationBatchArgs): Promise<TranslationBatchResult>;
}
