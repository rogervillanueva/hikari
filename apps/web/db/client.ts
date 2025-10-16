import Dexie, { Table } from "dexie";

export interface SentenceRecord {
  id: string;
  content: string;
  translation_en?: string;
  translation_ja?: string;
  updatedAt: number;
}

export interface CacheRecord {
  key: string;
  value: string;
  updatedAt: number;
  expiresAt?: number;
}

const TRANSLATION_DB_NAME = "hikari-translations";

export class HikariDexie extends Dexie {
  sentences!: Table<SentenceRecord, string>;
  caches!: Table<CacheRecord, string>;

  constructor() {
    super(TRANSLATION_DB_NAME);
    this.version(1).stores({
      sentences: "&id,translation_en,translation_ja",
      caches: "&key,updatedAt",
    });
  }
}

export const hikariDb = new HikariDexie();
