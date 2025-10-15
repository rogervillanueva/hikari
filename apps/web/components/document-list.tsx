'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useDocumentsStore } from '@/store/documents';

export function DocumentList() {
  const documents = useDocumentsStore((state) => state.documents);
  const loading = useDocumentsStore((state) => state.loading);
  const loadDocuments = useDocumentsStore((state) => state.loadDocuments);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  if (loading && !documents.length) {
    return <p className="text-sm text-neutral-500">Loading documents…</p>;
  }

  if (!documents.length) {
    return <p className="text-sm text-neutral-500">No documents yet. Import some text to begin.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {documents.map((doc) => (
        <Link
          key={doc.id}
          href={`/documents/${doc.id}`}
          className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-primary dark:border-neutral-800 dark:bg-neutral-900"
        >
          <span className="text-lg font-semibold">{doc.title}</span>
          <span className="text-xs text-neutral-500">{new Date(doc.updatedAt).toLocaleString()}</span>
          <span className="text-xs text-neutral-500">
            {doc.size_chars} chars • {doc.size_tokens} tokens (approx.)
          </span>
        </Link>
      ))}
    </div>
  );
}
