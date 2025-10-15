'use client';

import demoJa from '@/fixtures/demo-lotr-ja.txt';
import demoEn from '@/fixtures/demo-lotr-en.txt';
import { db } from '@/lib/db';
import { createId } from '@/lib/id';
import type { Sentence } from '@/lib/types';
import { sentenceSplitter } from '@/workers/sentence-segmentation';

export async function seedDemo() {
  const existing = await db.documents.where('title').equals('Demo: Fellowship on Caradhras').first();
  if (existing) {
    await db.sentences.where('documentId').equals(existing.id).delete();
    await db.documents.delete(existing.id);
  }

  const id = createId('doc');
  const createdAt = Date.now();
  await db.documents.put({
    id,
    title: 'Demo: Fellowship on Caradhras',
    source_kind: 'paste',
    lang_source: 'ja',
    lang_target: 'en',
    size_chars: demoJa.length,
    size_tokens: demoJa.split(/\s+/).length,
    createdAt,
    updatedAt: createdAt
  });

  const jaSentences = sentenceSplitter(demoJa);
  const enSentences = demoEn.trim().split(/\r?\n/);

  const records: Sentence[] = jaSentences.map((sentence, index) => ({
    id: createId('sent'),
    documentId: id,
    index,
    text_raw: sentence,
    text_norm: sentence,
    tokens: [],
    translation_en: enSentences[index] ?? undefined
  }));

  await db.sentences.bulkPut(records);
}

export async function resetDemoData() {
  await db.sentences.clear();
  await db.documents.clear();
}
