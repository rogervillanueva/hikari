import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold">Hikari Reader</h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-300">
          Welcome! Import a document to start reading with sentence-level navigation,
          inline translations, and synced audio. Use the demo seed to explore the
          experience without configuring providers.
        </p>
      </section>
      <div className="flex flex-wrap gap-3">
        <Link
          className="rounded-md bg-primary px-4 py-2 font-medium text-white hover:bg-neutral-800"
          href="/documents"
        >
          Go to documents
        </Link>
        <Link
          className="rounded-md border border-neutral-400 px-4 py-2 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-900"
          href="/dev/seed"
        >
          Seed demo data
        </Link>
      </div>
    </div>
  );
}
