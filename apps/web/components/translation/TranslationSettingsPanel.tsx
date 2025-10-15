import React from "react";
import { ProviderSelect } from "./ProviderSelect";
import { useTranslationSettings } from "../../state/translationStore";
import { TranslationDirection } from "../../providers/translation/base";

export const TranslationSettingsPanel: React.FC = () => {
  const { directions, setDirectionEnabled } = useTranslationSettings();

  return (
    <section className="translation-settings-panel">
      <h2>Translation settings</h2>
      <ProviderSelect />
      <fieldset>
        <legend>Available directions</legend>
        {Object.entries(directions).map(([direction, enabled]) => {
          const typedDirection = direction as TranslationDirection;
          return (
            <label key={direction} className="translation-settings-panel__direction">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setDirectionEnabled(typedDirection, event.target.checked)}
              />
              <span>
                {typedDirection === "ja-en"
                  ? "Japanese → English"
                  : "English → Japanese"}
              </span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
};
