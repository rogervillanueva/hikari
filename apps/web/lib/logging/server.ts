import { promises as fs } from 'fs';
import path from 'path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface ServerLogEntry {
  level: LogLevel;
  category: string;
  message: string;
  details?: unknown;
}

const DEFAULT_LOG_DIR = process.env.SERVER_LOG_DIR ?? path.join(process.cwd(), '.logs');

let ensureDirPromise: Promise<void> | null = null;

async function ensureLogDirExists(): Promise<void> {
  if (!ensureDirPromise) {
    ensureDirPromise = fs.mkdir(DEFAULT_LOG_DIR, { recursive: true }).catch((error) => {
      ensureDirPromise = null;
      throw error;
    });
  }
  return ensureDirPromise;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLogDirectory(): string {
  return DEFAULT_LOG_DIR;
}

export function getLogFileName(date: Date = new Date()): string {
  return `server-${formatDate(date)}.log`;
}

export function getLogFilePath(date: Date = new Date()): string {
  return path.join(DEFAULT_LOG_DIR, getLogFileName(date));
}

export async function logServerEvent(entry: ServerLogEntry): Promise<void> {
  try {
    await ensureLogDirExists();
    const filePath = getLogFilePath();
    const details = entry.details === undefined ? null : sanitizeForLog(entry.details);
    const payload = {
      timestamp: new Date().toISOString(),
      level: entry.level,
      category: entry.category,
      message: entry.message,
      details,
    };
    const line = JSON.stringify(payload) + '\n';
    await fs.appendFile(filePath, line, 'utf8');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[server-logger] failed to write log entry', error);
  }
}

function sanitizeForLog(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name || 'Error',
      message: value.message,
      stack: value.stack,
      cause: value.cause ? sanitizeForLog(value.cause, seen) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[Circular]';
    }
    seen.add(value as object);
    const entries: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      entries[key] = sanitizeForLog(val, seen);
    }
    return entries;
  }
  if (typeof value === 'undefined') {
    return undefined;
  }
  return String(value);
}

export interface LatestLogFile {
  path: string;
  name: string;
}

export async function getLatestLogFile(): Promise<LatestLogFile | null> {
  try {
    await ensureLogDirExists();
    const files = await fs.readdir(DEFAULT_LOG_DIR);
    if (!files.length) {
      return null;
    }
    const logFiles = files.filter((file) => file.endsWith('.log')).sort();
    if (!logFiles.length) {
      return null;
    }
    const latest = logFiles[logFiles.length - 1];
    return { path: path.join(DEFAULT_LOG_DIR, latest), name: latest };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[server-logger] failed to read log directory', error);
    return null;
  }
}
