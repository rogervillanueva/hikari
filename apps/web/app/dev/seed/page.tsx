'use client';

import { useState } from 'react';
import Link from 'next/link';
import { seedDemo, resetDemoData } from '@/scripts/seed-demo';

export default function SeedPage() {
  const [status, setStatus] = useState<string>('');

  const handleSeed = async () => {
    setStatus('Seeding demo data…');
    await seedDemo();
    setStatus('Demo data seeded. Visit the documents page to explore the reader.');
  };

  const handleReset = async () => {
    setStatus('Clearing data…');
    await resetDemoData();
    setStatus('All documents removed.');
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Demo Data Utilities</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        Use this page during development to populate IndexedDB with a ready-to-read Japanese document and
        paired mock translations. All operations run locally.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleSeed}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
        >
          Seed Demo Data
        </button>
        <button
          onClick={handleReset}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold hover:border-primary dark:border-neutral-700"
        >
          Reset All Data
        </button>
        <Link
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold hover:border-primary dark:border-neutral-700"
          href="/documents"
        >
          Open Documents
        </Link>
      </div>
      {status && <p className="text-sm text-neutral-500">{status}</p>}
    </div>
  );
}
