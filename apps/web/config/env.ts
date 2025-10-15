export interface TranslationEnvConfig {
  defaultProvider: string;
  documentBudgetCents: number;
  azure: {
    endpoint: string;
    region: string;
    apiKey: string;
    pricePerCharacterUsd: number;
  };
}

const centsFromEnv = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
};

const floatFromEnv = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const translationEnv: TranslationEnvConfig = {
  defaultProvider: process.env.NEXT_PUBLIC_PROVIDER ?? "azure-translation",
  documentBudgetCents: centsFromEnv(process.env.NEXT_PUBLIC_TRANSLATION_BUDGET_CENTS, 500),
  azure: {
    endpoint: process.env.AZURE_TRANSLATION_ENDPOINT ?? "",
    region: process.env.AZURE_TRANSLATION_REGION ?? "global",
    apiKey: process.env.AZURE_TRANSLATION_KEY ?? "",
    pricePerCharacterUsd: floatFromEnv(
      process.env.AZURE_TRANSLATION_PRICE_PER_CHARACTER_USD,
      0.00002
    ),
  },
};
