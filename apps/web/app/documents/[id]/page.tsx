import { ReaderView } from '@/components/reader-view';

interface DocumentPageProps {
  params: { id: string };
}

export default function DocumentPage({ params }: DocumentPageProps) {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <ReaderView documentId={params.id} />
    </div>
  );
}
