import { Suspense } from 'react';
import { DocumentList } from '@/components/document-list';
import { ImportTextForm } from '@/components/import-text-form';

export default function DocumentsPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Import text or PDFs to build sentence-aligned reading experiences. Processing happens in your
          browser and can work offline once cached.
        </p>
      </header>
      <Suspense fallback={<p>Loading form…</p>}>
        <ImportTextForm />
      </Suspense>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Library</h2>
        <Suspense fallback={<p>Loading documents…</p>}>
          <DocumentList />
        </Suspense>
      </section>
    </div>
  );
}
