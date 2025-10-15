'use client';

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import type { SrsEntry } from '@/lib/types';
import { updateSrsItem } from '@/lib/srs';

interface SrsState {
  entries: SrsEntry[];
  loading: boolean;
  load(): Promise<void>;
  saveEntry(entry: Omit<SrsEntry, 'id'> & { id?: string }): Promise<SrsEntry>;
  review(id: string, grade: 0 | 1 | 2 | 3 | 4 | 5): Promise<void>;
}

export const useSrsStore = create<SrsState>((set, get) => ({
  entries: [],
  loading: false,
  async load() {
    set({ loading: true });
    const entries = await db.srs_entries.toArray();
    set({ entries, loading: false });
  },
  async saveEntry(entry) {
    const now = Date.now();
    const id = entry.id ?? nanoid();
    const stored: SrsEntry = {
      ...entry,
      id,
      srs: entry.srs ?? {
        EF: 2.5,
        interval: 0,
        reps: 0,
        due: now,
        last: now
      }
    };
    await db.srs_entries.put(stored);
    await get().load();
    return stored;
  },
  async review(id, grade) {
    const entry = await db.srs_entries.get(id);
    if (!entry) return;
    entry.srs = updateSrsItem(entry.srs, grade);
    await db.srs_entries.put(entry);
    await get().load();
  }
}));
