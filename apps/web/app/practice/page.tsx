'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSrsStore } from '@/store/srs';

export default function PracticePage() {
  const { entries, load, review } = useSrsStore((state) => ({
    entries: state.entries,
    load: state.load,
    review: state.review
  }));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  const dueEntries = useMemo(() => entries.filter((entry) => entry.srs.due <= Date.now()), [entries]);
  const current = dueEntries[currentIndex];

  const handleGrade = async (grade: 0 | 1 | 2 | 3 | 4 | 5) => {
    if (!current) return;
    await review(current.id, grade);
    setShowAnswer(false);
    setCurrentIndex((index) => Math.min(index, Math.max(0, dueEntries.length - 2)));
  };

  if (!entries.length) {
    return <p className="p-6 text-sm text-neutral-500">No saved words yet. Save words from the reader popup to practice them here.</p>;
  }

  if (!current) {
    return <p className="p-6 text-sm text-neutral-500">All reviews complete for today. Great job!</p>;
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Practice</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Review due cards using an SM-2-inspired scheduler. Grades sync to IndexedDB.
        </p>
      </header>
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm text-neutral-500">Card {currentIndex + 1} / {dueEntries.length}</p>
        <p className="mt-6 text-4xl font-semibold">{current.fields.target}</p>
        {showAnswer ? (
          <div className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
            {current.fields.reading && <p>Reading: {current.fields.reading}</p>}
            {current.fields.definition_en && <p>Meaning: {current.fields.definition_en}</p>}
            {current.fields.example && (
              <p>
                Example: {current.fields.example.jp}
                {current.fields.example.en ? ` / ${current.fields.example.en}` : ''}
              </p>
            )}
          </div>
        ) : (
          <button
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
            onClick={() => setShowAnswer(true)}
          >
            Show answer
          </button>
        )}
      </div>
      {showAnswer && (
        <div className="flex flex-wrap justify-center gap-2">
          {[0, 1, 2, 3, 4, 5].map((grade) => (
            <button
              key={grade}
              className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-semibold hover:border-primary dark:border-neutral-700"
              onClick={() => handleGrade(grade as 0 | 1 | 2 | 3 | 4 | 5)}
            >
              {grade === 0 ? 'Fail' : grade === 5 ? 'Easy' : `Grade ${grade}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
