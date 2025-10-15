import React from "react";
import { useTranslationSettings } from "../../state/translationStore";

export const ProviderSelect: React.FC = () => {
  const { providerName, setProviderName, availableProviders, isTranslating } =
    useTranslationSettings();

  return (
    <label className="translation-provider-select">
      <span>Translation provider</span>
      <select
        value={providerName}
        onChange={(event) => setProviderName(event.target.value)}
        disabled={isTranslating}
      >
        {availableProviders.map((provider) => (
          <option key={provider.name} value={provider.name}>
            {provider.label}
          </option>
        ))}
      </select>
    </label>
  );
};
