'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/db';

interface Stats {
  documents: number;
  sentences: number;
  srs: number;
  caches: number;
}

export default function DebugPage() {
  const [stats, setStats] = useState<Stats>({ documents: 0, sentences: 0, srs: 0, caches: 0 });

  useEffect(() => {
    const load = async () => {
      const [documents, sentences, srs, caches] = await Promise.all([
        db.documents.count(),
        db.sentences.count(),
        db.srs_entries.count(),
        db.caches.count()
      ]);
      setStats({ documents, sentences, srs, caches });
    };
    load();
  }, []);

  const handleClearCaches = async () => {
    await db.caches.clear();
    setStats((prev) => ({ ...prev, caches: 0 }));
  };

  const handleClearAudio = async () => {
    await db.audio.clear();
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Debug Dashboard</h1>
      <table className="w-full table-auto text-sm">
        <tbody>
          <tr>
            <td className="py-2 font-semibold">Documents</td>
            <td>{stats.documents}</td>
          </tr>
          <tr>
            <td className="py-2 font-semibold">Sentences</td>
            <td>{stats.sentences}</td>
          </tr>
          <tr>
            <td className="py-2 font-semibold">SRS entries</td>
            <td>{stats.srs}</td>
          </tr>
          <tr>
            <td className="py-2 font-semibold">Cache entries</td>
            <td>{stats.caches}</td>
          </tr>
        </tbody>
      </table>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleClearCaches}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold hover:border-primary dark:border-neutral-700"
        >
          Clear caches table
        </button>
        <button
          onClick={handleClearAudio}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold hover:border-primary dark:border-neutral-700"
        >
          Clear audio table
        </button>
      </div>
    </div>
  );
}
