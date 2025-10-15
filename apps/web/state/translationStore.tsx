import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { translationEnv } from "../config/env";
import { getTranslationProvider, listTranslationProviders } from "../providers/translation";
import {
  TranslationDirection,
  TranslationSentence,
} from "../providers/translation/base";
import { translateSentences as translateSentencesImpl } from "../utils/translateSentences";

const STORAGE_KEY = "hikari.translation.settings";

type DirectionToggleMap = Record<TranslationDirection, boolean>;

const defaultDirections: DirectionToggleMap = {
  "ja-en": true,
  "en-ja": false,
};

interface TranslationContextValue {
  providerName: string;
  setProviderName: (provider: string) => void;
  directions: DirectionToggleMap;
  setDirectionEnabled: (direction: TranslationDirection, enabled: boolean) => void;
  availableProviders: Array<{ name: string; label: string }>;
  isTranslating: boolean;
  lastConsumedBudgetCents: number;
  error?: string;
  translate: (args: {
    sentences: TranslationSentence[];
    direction: TranslationDirection;
    documentId: string;
    budgetCents?: number;
    abortSignal?: AbortSignal;
  }) => Promise<Record<string, string>>;
}

const TranslationSettingsContext = createContext<TranslationContextValue | undefined>(undefined);

interface PersistedSettings {
  providerName: string;
  directions: DirectionToggleMap;
}

const readPersistedSettings = (): PersistedSettings | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as PersistedSettings;
  } catch (error) {
    console.warn("Unable to read translation settings", error);
    return undefined;
  }
};

const writePersistedSettings = (settings: PersistedSettings) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("Unable to persist translation settings", error);
  }
};

export const TranslationSettingsProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [providerName, setProviderNameState] = useState(() => translationEnv.defaultProvider);
  const [directions, setDirections] = useState<DirectionToggleMap>(defaultDirections);
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string>();
  const [lastConsumedBudgetCents, setLastConsumedBudgetCents] = useState(0);

  useEffect(() => {
    const persisted = readPersistedSettings();
    if (persisted) {
      if (persisted.providerName) {
        setProviderNameState(persisted.providerName);
      }
      if (persisted.directions) {
        setDirections({ ...defaultDirections, ...persisted.directions });
      }
    }
  }, []);

  useEffect(() => {
    writePersistedSettings({ providerName, directions });
  }, [providerName, directions]);

  const availableProviders = useMemo(
    () => listTranslationProviders().map((provider) => ({
      name: provider.name,
      label: provider.label,
    })),
    []
  );

  const setProviderName = useCallback((name: string) => {
    getTranslationProvider(name); // throws if invalid
    setProviderNameState(name);
  }, []);

  const setDirectionEnabled = useCallback(
    (direction: TranslationDirection, enabled: boolean) => {
      setDirections((prev) => ({ ...prev, [direction]: enabled }));
    },
    []
  );

  const translate = useCallback<TranslationContextValue["translate"]>(
    async ({ sentences, direction, documentId, budgetCents, abortSignal }) => {
      setIsTranslating(true);
      setError(undefined);
      try {
        const { translations, consumedBudgetCents } = await translateSentencesImpl({
          sentences,
          direction,
          documentId,
          providerName,
          budgetCents,
          abortSignal,
        });
        setLastConsumedBudgetCents(consumedBudgetCents);
        return translations;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Translation failed";
        setError(message);
        throw err;
      } finally {
        setIsTranslating(false);
      }
    },
    [providerName]
  );

  const value = useMemo<TranslationContextValue>(
    () => ({
      providerName,
      setProviderName,
      directions,
      setDirectionEnabled,
      availableProviders,
      isTranslating,
      lastConsumedBudgetCents,
      error,
      translate,
    }),
    [
      providerName,
      setProviderName,
      directions,
      setDirectionEnabled,
      availableProviders,
      isTranslating,
      lastConsumedBudgetCents,
      error,
      translate,
    ]
  );

  return (
    <TranslationSettingsContext.Provider value={value}>
      {children}
    </TranslationSettingsContext.Provider>
  );
};

export const useTranslationSettings = (): TranslationContextValue => {
  const context = useContext(TranslationSettingsContext);
  if (!context) {
    throw new Error("useTranslationSettings must be used within TranslationSettingsProvider");
  }
  return context;
};
