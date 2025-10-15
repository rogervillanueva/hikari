'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Settings } from '@/lib/types';
import { db, getOrCreateSettings } from '@/lib/db';

interface SettingsState {
  settings: Settings | null;
  loading: boolean;
  load(): Promise<void>;
  update(partial: Partial<Settings>): Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: null,
      loading: false,
      async load() {
        if (get().loading || get().settings) return;
        set({ loading: true });
        const data = await getOrCreateSettings();
        set({ settings: data, loading: false });
      },
      async update(partial) {
        const current = get().settings;
        if (!current) return;
        const next = { ...current, ...partial } as Settings;
        await db.settings.put(next);
        set({ settings: next });
      }
    }),
    {
      name: 'hikari-settings'
    }
  )
);
