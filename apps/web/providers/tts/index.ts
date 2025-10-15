import type { TtsProvider } from './types';
import { mockTtsProvider } from './mock';
import { azureTtsProvider } from './azure';

const registry: Record<string, TtsProvider> = {
  mock: mockTtsProvider,
  azure: azureTtsProvider
};

export function getTtsProvider(id: string): TtsProvider {
  return registry[id] ?? mockTtsProvider;
}

export function listTtsProviders(): TtsProvider[] {
  return Object.values(registry);
}
