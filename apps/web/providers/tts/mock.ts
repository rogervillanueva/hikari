'use client';

import { createId } from '@/lib/id';
import type { TtsProvider, TtsResult } from './types';

const audioCache = new Map<string, string>();

async function generateBeep(durationMs: number): Promise<string> {
  const ctx = new AudioContext();
  const sampleRate = ctx.sampleRate;
  const frameCount = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    channel[i] = Math.sin((i / sampleRate) * Math.PI * 440);
  }
  const destination = ctx.createBufferSource();
  destination.buffer = buffer;
  const offline = new OfflineAudioContext(1, frameCount, sampleRate);
  const offlineSource = offline.createBufferSource();
  offlineSource.buffer = buffer;
  offlineSource.connect(offline.destination);
  offlineSource.start();
  const rendered = await offline.startRendering();
  const wav = audioBufferToWav(rendered);
  const blob = new Blob([wav], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function audioBufferToWav(buffer: AudioBuffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  const channels = [];
  let offset = 0;
  let pos = 0;

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8);
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt "
  setUint32(16);
  setUint16(1);
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);
  setUint32(0x61746164); // "data"
  setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i += 1) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < length) {
    for (let i = 0; i < numOfChan; i += 1) {
      const sample = Math.max(-1, Math.min(1, channels[i][offset]));
      view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      pos += 2;
    }
    offset += 1;
  }

  return bufferArray;

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

export const mockTtsProvider: TtsProvider = {
  id: 'mock',
  label: 'Mock TTS (beep)',
  async speakSentence(text, lang) {
    console.info('[tts:mock] speakSentence', { text, lang });
    const durationMs = Math.max(750, text.length * 40);
    const audioId = createId('audio');
    const url = await generateBeep(durationMs);
    audioCache.set(audioId, url);
    const marks: TtsResult['marks'] = [
      { offsetMs: 0, tag: 'start' },
      { offsetMs: durationMs, tag: 'end' }
    ];
    return {
      audioId,
      durationMs,
      marks
    };
  },
  async getAudioUrl(audioId) {
    const existing = audioCache.get(audioId);
    if (!existing) {
      throw new Error(`Audio ${audioId} not found in mock cache`);
    }
    return existing;
  }
};

export const ttsProviders: Record<string, TtsProvider> = {
  mock: mockTtsProvider
};

export function getTtsProvider(id: string): TtsProvider {
  return ttsProviders[id] ?? mockTtsProvider;
}
