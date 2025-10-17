'use client';

import { useEffect } from 'react';

export default function DocumentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Documents page error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-md mx-auto">
        <h2 className="text-xl font-bold text-red-600 mb-4">
          Error loading documents
        </h2>
        <p className="text-gray-600 mb-6">
          There was a problem loading your documents. Please try again.
        </p>
        <button
          onClick={reset}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}