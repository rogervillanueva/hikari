'use client';

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import type { DocumentMeta, Sentence } from '@/lib/types';
import { sentenceSplitter } from '@/workers/sentence-segmentation';

interface DocumentsState {
  documents: DocumentMeta[];
  sentences: Record<string, Sentence[]>;
  loading: boolean;
  loadDocuments(): Promise<void>;
  createFromText(title: string, text: string, source: 'paste' | 'pdf'): Promise<DocumentMeta>;
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  documents: [],
  sentences: {},
  loading: false,
  async loadDocuments() {
    set({ loading: true });
    const docs = await db.documents.orderBy('createdAt').reverse().toArray();
    const sentenceMap: Record<string, Sentence[]> = {};
    for (const doc of docs) {
      const sentences = await db.sentences.where('documentId').equals(doc.id).toArray();
      sentenceMap[doc.id] = sentences.sort((a, b) => a.index - b.index);
    }
    set({ documents: docs, sentences: sentenceMap, loading: false });
  },
  async createFromText(title, text, source) {
    const now = Date.now();
    const id = nanoid();
    const segmentedSentences = sentenceSplitter(text);
    const flattenedSentences = segmentedSentences.map((entry) => entry.text);
    const doc: DocumentMeta = {
      id,
      title,
      source_kind: source,
      lang_source: 'ja',
      lang_target: 'en',
      size_chars: text.length,
      size_tokens: flattenedSentences.join(' ').length,
      createdAt: now,
      updatedAt: now
    };
    await db.documents.put(doc);
    await Promise.all(
      segmentedSentences.map((sentence, index) =>
        db.sentences.put({
          id: nanoid(),
          documentId: id,
          index,
          text_raw: sentence.text,
          text_norm: sentence.text,
          paragraphIndex: sentence.paragraphIndex,
          tokens: []
        })
      )
    );
    await get().loadDocuments();
    return doc;
  }
}));
