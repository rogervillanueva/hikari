import { translationEnv } from '../config/env';

export const ACTIVE_TRANSLATION_PROVIDER = translationEnv.defaultProvider;
export const ACTIVE_TTS_PROVIDER = process.env.NEXT_PUBLIC_TTS_PROVIDER ?? 'azure';
export const ACTIVE_DICTIONARY_PROVIDER = process.env.NEXT_PUBLIC_DICTIONARY_PROVIDER ?? 'mock';
