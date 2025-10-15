'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/store/settings';

export default function SettingsPage() {
  const { settings, load, update } = useSettingsStore((state) => ({
    settings: state.settings,
    load: state.load,
    update: state.update
  }));

  useEffect(() => {
    load();
  }, [load]);

  if (!settings) {
    return <p className="p-6 text-sm text-neutral-500">Loading settings…</p>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Configure translation budgets, playback behavior, and Japanese display preferences. Values are stored locally in IndexedDB.
        </p>
      </header>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Translation</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span>Per-document budget (cents, 0 = unlimited)</span>
          <input
            type="number"
            className="w-40 rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700"
            value={settings.translation.budgetCents ?? 0}
            onChange={(event) =>
              update({ translation: { ...settings.translation, budgetCents: Number(event.target.value) } as any })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Window size (page words × prefetch pages)</span>
          <input
            type="number"
            className="w-24 rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700"
            value={settings.translation.pageWords}
            onChange={(event) =>
              update({ translation: { ...settings.translation, pageWords: Number(event.target.value) } as any })
            }
          />
        </label>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Reader</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.reader.highlightActive}
            onChange={(event) =>
              update({ reader: { ...settings.reader, highlightActive: event.target.checked } as any })
            }
          />
          Highlight active sentence during playback
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.reader.showSentenceTranslation}
            onChange={(event) =>
              update({ reader: { ...settings.reader, showSentenceTranslation: event.target.checked } as any })
            }
          />
          Always show translations
        </label>
      </section>
    </div>
  );
}
