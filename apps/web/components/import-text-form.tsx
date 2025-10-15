'use client';

import { useState } from 'react';
import { useDocumentsStore } from '@/store/documents';

interface ImportTextFormProps {
  onImported?: (id: string) => void;
}

export function ImportTextForm({ onImported }: ImportTextFormProps) {
  const [title, setTitle] = useState('Untitled document');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const create = useDocumentsStore((state) => state.createFromText);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const doc = await create(title.trim() || 'Untitled', text, 'paste');
    setBusy(false);
    setText('');
    onImported?.(doc.id);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="title">
          Document title
        </label>
        <input
          id="title"
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none dark:border-neutral-700 dark:bg-neutral-950"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="text">
          Paste Japanese or English text
        </label>
        <textarea
          id="text"
          required
          className="h-48 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none dark:border-neutral-700 dark:bg-neutral-950"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="長めの文章を貼り付けてください。"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60"
      >
        {busy ? 'Importing…' : 'Save document'}
      </button>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Text is processed locally and stored in your browser via IndexedDB. Large documents may
        take a moment while sentences are indexed.
      </p>
    </form>
  );
}
