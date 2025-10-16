import { hikariDb, HikariDexie, SentenceRecord } from "../db/client";
import { translationEnv } from "../config/env";
import { getTranslationProvider } from "../providers/translation";
import {
  TranslationBatchResult,
  TranslationDirection,
  TranslationEstimate,
  TranslationSentence,
} from "../providers/translation/base";

export interface TranslateSentencesParams {
  sentences: TranslationSentence[];
  direction: TranslationDirection;
  documentId: string;
  providerName?: string;
  db?: HikariDexie;
  budgetCents?: number;
  batchSize?: number;
  maxCharactersPerBatch?: number;
  abortSignal?: AbortSignal;
}

export interface TranslateSentencesResult {
  translations: Record<string, string>;
  consumedBudgetCents: number;
}

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_CHARACTERS_PER_BATCH = 4500;

type TranslationField = "translation_en" | "translation_ja";

const directionToLanguages: Record<
  TranslationDirection,
  { src: "ja" | "en"; tgt: "ja" | "en" }
> = {
  "ja-en": { src: "ja", tgt: "en" },
  "en-ja": { src: "en", tgt: "ja" },
};

const fieldForDirection = (direction: TranslationDirection): TranslationField =>
  direction === "ja-en" ? "translation_en" : "translation_ja";

const cacheKey = (
  provider: string,
  direction: TranslationDirection,
  sentence: TranslationSentence
): string => `${provider}:${direction}:${sentence.text}`;

const chunkSentences = (
  sentences: TranslationSentence[],
  batchSize: number,
  maxCharacters: number
): TranslationSentence[][] => {
  const batches: TranslationSentence[][] = [];
  let current: TranslationSentence[] = [];
  let currentCharacters = 0;

  sentences.forEach((sentence) => {
    const sentenceLength = sentence.text.length;
    if (
      current.length >= batchSize ||
      (currentCharacters > 0 && currentCharacters + sentenceLength > maxCharacters)
    ) {
      batches.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(sentence);
    currentCharacters += sentenceLength;
  });

  if (current.length) {
    batches.push(current);
  }

  return batches;
};

interface ProxyBatchArgs {
  batch: TranslationSentence[];
  direction: TranslationDirection;
  documentId: string;
  estimate: TranslationEstimate;
  abortSignal?: AbortSignal;
  providerName: string;
}

async function proxyTranslateBatchThroughApi(
  args: ProxyBatchArgs
): Promise<TranslationBatchResult> {
  const { batch, direction, documentId, estimate, abortSignal, providerName } = args;
  const languages = directionToLanguages[direction];
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sentences: batch.map((sentence) => sentence.text),
      src: languages.src,
      tgt: languages.tgt,
      documentId,
      provider: providerName,
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Translation request failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as {
    translations: string[];
    consumedBudgetCents?: number;
  };

  const translations = batch.map((sentence, index) => ({
    id: sentence.id,
    translatedText: payload.translations[index] ?? "",
  }));

  return {
    translations,
    consumedBudgetCents: payload.consumedBudgetCents ?? estimate.estimatedCostCents,
    providerMetadata: {
      via: "api",
      billableCharacters: estimate.billableCharacters,
    },
  };
}

export const translateSentences = async (
  params: TranslateSentencesParams
): Promise<TranslateSentencesResult> => {
  const {
    sentences,
    direction,
    documentId,
    providerName,
    db = hikariDb,
    budgetCents = translationEnv.documentBudgetCents,
    batchSize = DEFAULT_BATCH_SIZE,
    maxCharactersPerBatch = DEFAULT_MAX_CHARACTERS_PER_BATCH,
    abortSignal,
  } = params;

  const provider = getTranslationProvider(providerName);
  const translationField = fieldForDirection(direction);

  const results: Record<string, string> = {};

  const shouldProxyThroughApi =
    provider.name === "azure-translation" &&
    (!translationEnv.azure.endpoint || !translationEnv.azure.apiKey);

  if (!sentences.length) {
    return { translations: results, consumedBudgetCents: 0 };
  }

  const ids = sentences.map((sentence) => sentence.id);
  const existingRecords = await db.sentences.bulkGet(ids);
  const existingMap = new Map<string, SentenceRecord>();
  existingRecords.forEach((record) => {
    if (record) {
      existingMap.set(record.id, record);
    }
  });

  const sentencesToTranslate: TranslationSentence[] = [];

  await Promise.all(
    sentences.map(async (sentence, index) => {
      const existing = existingRecords[index];
      if (existing && existing[translationField]) {
        results[sentence.id] = existing[translationField] as string;
        return;
      }

      const cached = await db.caches.get(cacheKey(provider.name, direction, sentence));
      if (cached) {
        results[sentence.id] = cached.value;
        return;
      }

      sentencesToTranslate.push(sentence);
    })
  );

  let remainingBudget = budgetCents;
  let consumedBudget = 0;

  const batches = chunkSentences(sentencesToTranslate, batchSize, maxCharactersPerBatch);

  for (const batch of batches) {
    if (!batch.length) {
      continue;
    }

    const estimate = provider.estimateCost(batch, direction);
    if (estimate.estimatedCostCents > remainingBudget) {
      throw new Error("Document translation budget exhausted");
    }

    const response = shouldProxyThroughApi
      ? await proxyTranslateBatchThroughApi({
          batch,
          direction,
          documentId,
          estimate,
          abortSignal,
          providerName: provider.name,
        })
      : await provider.translateBatch({
          sentences: batch,
          direction,
          documentId,
          remainingBudgetCents: remainingBudget,
          abortSignal,
        });

    consumedBudget += response.consumedBudgetCents;
    remainingBudget -= response.consumedBudgetCents;

    const now = Date.now();

    await db.transaction("rw", db.sentences, db.caches, async () => {
      const updates: Promise<unknown>[] = [];

      response.translations.forEach((translation, index) => {
        const sentence = batch[index];
        const translatedText = translation.translatedText;
        results[sentence.id] = translatedText;

        const record = existingMap.get(sentence.id) ?? {
          id: sentence.id,
          content: sentence.text,
          translation_en: undefined,
          translation_ja: undefined,
          updatedAt: now,
        };

        record.content = record.content ?? sentence.text;
        record.updatedAt = now;
        (record as SentenceRecord)[translationField] = translatedText;
        existingMap.set(sentence.id, record as SentenceRecord);

        updates.push(db.sentences.put(record as SentenceRecord));
        updates.push(
          db.caches.put({
            key: cacheKey(provider.name, direction, sentence),
            value: translatedText,
            updatedAt: now,
          })
        );
      });

      await Promise.all(updates);
    });
  }

  return { translations: results, consumedBudgetCents: consumedBudget };
};
