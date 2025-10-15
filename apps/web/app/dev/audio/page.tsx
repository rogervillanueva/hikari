'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/db';
import type { AudioEntry } from '@/lib/types';

export default function AudioInspectorPage() {
  const [entries, setEntries] = useState<AudioEntry[]>([]);

  useEffect(() => {
    const load = async () => {
      const data = await db.audio.toArray();
      setEntries(data);
    };
    load();
  }, []);

  const handleDelete = async (id: string) => {
    await db.audio.delete(id);
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Audio Inspector</h1>
      {entries.length === 0 ? (
        <p className="text-sm text-neutral-500">No cached audio yet.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
              <div>
                <p className="font-semibold">{entry.textHash}</p>
                <p className="text-xs text-neutral-500">
                  {entry.provider} • {entry.kind} • {Math.round(entry.durationMs)}ms
                </p>
              </div>
              <div className="flex gap-2">
                {entry.url ? (
                  <audio controls src={entry.url} className="h-8" />
                ) : (
                  <span className="text-xs text-neutral-500">In-memory blob</span>
                )}
                <button
                  onClick={() => handleDelete(entry.id)}
                  className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-semibold hover:border-primary dark:border-neutral-700"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
