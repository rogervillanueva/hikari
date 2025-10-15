import { translationEnv } from "../../config/env";
import { azureTranslationProvider } from "./azure";
import { TranslationProvider } from "./base";

const providers: Record<string, TranslationProvider> = {
  [azureTranslationProvider.name]: azureTranslationProvider,
};

export const getTranslationProvider = (name?: string): TranslationProvider => {
  const providerName = name ?? translationEnv.defaultProvider;
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`Unknown translation provider: ${providerName}`);
  }
  return provider;
};

export const listTranslationProviders = (): TranslationProvider[] => Object.values(providers);
