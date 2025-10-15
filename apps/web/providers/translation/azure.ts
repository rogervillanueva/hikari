import { translationEnv } from "../../config/env";
import {
  TranslationBatchArgs,
  TranslationBatchResult,
  TranslationDirection,
  TranslationProvider,
  TranslationSentence,
} from "./base";

const API_VERSION = "3.0";

const directionToLanguages: Record<TranslationDirection, { from: string; to: string }> = {
  "ja-en": { from: "ja", to: "en" },
  "en-ja": { from: "en", to: "ja" },
};

const randomId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const characterCount = (sentences: TranslationSentence[]): number =>
  sentences.reduce((sum, sentence) => sum + sentence.text.length, 0);

class AzureTranslationProvider implements TranslationProvider {
  readonly name = "azure-translation";
  readonly label = "Azure Cognitive Services";

  estimateCost(sentences: TranslationSentence[], direction: TranslationDirection) {
    const billableCharacters = characterCount(sentences);
    const { pricePerCharacterUsd } = translationEnv.azure;
    const estimatedCostCents = Math.ceil(pricePerCharacterUsd * billableCharacters * 100);
    return {
      billableCharacters,
      estimatedCostCents,
    };
  }

  async translateBatch(args: TranslationBatchArgs): Promise<TranslationBatchResult> {
    const { sentences, direction, remainingBudgetCents, abortSignal } = args;
    if (!sentences.length) {
      return { translations: [], consumedBudgetCents: 0 };
    }

    const { endpoint, apiKey, region } = translationEnv.azure;
    if (!endpoint || !apiKey) {
      throw new Error("Azure translation provider is not configured");
    }

    const estimate = this.estimateCost(sentences, direction);
    if (estimate.estimatedCostCents > remainingBudgetCents) {
      throw new Error("Document translation budget exceeded");
    }

    const languages = directionToLanguages[direction];
    const url = new URL("translate", endpoint.endsWith("/") ? endpoint : `${endpoint}/`);
    url.searchParams.set("api-version", API_VERSION);
    url.searchParams.set("from", languages.from);
    url.searchParams.append("to", languages.to);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": apiKey,
        "Ocp-Apim-Subscription-Region": region,
        "X-ClientTraceId": randomId(),
      },
      body: JSON.stringify(sentences.map((sentence) => ({ text: sentence.text }))),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure translation failed: ${response.status} ${errorText}`);
    }

    type AzureTranslation = {
      detectedLanguage?: { language: string };
      translations: Array<{ text: string }>;
    };

    const payload = (await response.json()) as AzureTranslation[];
    const translations = payload.map((entry, index) => ({
      id: sentences[index].id,
      translatedText: entry.translations?.[0]?.text ?? "",
      detectedSourceLanguage: entry.detectedLanguage?.language,
    }));

    return {
      translations,
      consumedBudgetCents: estimate.estimatedCostCents,
      providerMetadata: {
        billableCharacters: estimate.billableCharacters,
      },
    };
  }
}

export const azureTranslationProvider = new AzureTranslationProvider();
