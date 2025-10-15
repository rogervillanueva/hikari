import React, { useCallback } from "react";
import { useTranslationSettings } from "../../state/translationStore";
import { TranslationDirection, TranslationSentence } from "../../providers/translation/base";

export interface TranslationToggleProps {
  direction: TranslationDirection;
  sentences?: TranslationSentence[];
  documentId: string;
  label?: string;
  autoTrigger?: boolean;
}

const directionLabels: Record<TranslationDirection, string> = {
  "ja-en": "Show English translation",
  "en-ja": "Show Japanese translation",
};

export const TranslationToggle: React.FC<TranslationToggleProps> = ({
  direction,
  sentences = [],
  documentId,
  label,
  autoTrigger = false,
}) => {
  const {
    directions,
    setDirectionEnabled,
    translate,
    providerName,
    isTranslating,
    error,
    lastConsumedBudgetCents,
  } = useTranslationSettings();

  const isEnabled = directions[direction];

  const handleToggle = useCallback(() => {
    setDirectionEnabled(direction, !isEnabled);
  }, [direction, isEnabled, setDirectionEnabled]);

  const handleTranslate = useCallback(async () => {
    if (!sentences.length) {
      return;
    }
    const translations = await translate({
      sentences,
      direction,
      documentId,
    });
    if (Object.keys(translations).length) {
      setDirectionEnabled(direction, true);
    }
  }, [sentences, translate, direction, documentId, setDirectionEnabled]);

  React.useEffect(() => {
    if (autoTrigger && sentences.length && !isEnabled) {
      handleTranslate().catch((err) => {
        console.warn("Auto translation failed", err);
      });
    }
  }, [autoTrigger, sentences, isEnabled, handleTranslate]);

  const labelText = label ?? directionLabels[direction];

  return (
    <div className="translation-toggle">
      <div className="translation-toggle__header">
        <label>
          <input type="checkbox" checked={isEnabled} onChange={handleToggle} />
          <span>{labelText}</span>
        </label>
        <button
          type="button"
          onClick={handleTranslate}
          disabled={isTranslating || !sentences.length}
        >
          {isTranslating ? "Translating…" : "Translate now"}
        </button>
      </div>
      <p className="translation-toggle__meta">
        Provider: <strong>{providerName}</strong>
        {lastConsumedBudgetCents > 0 && (
          <span> · Last job cost {lastConsumedBudgetCents}¢</span>
        )}
      </p>
      {error && <p className="translation-toggle__error">{error}</p>}
    </div>
  );
};
