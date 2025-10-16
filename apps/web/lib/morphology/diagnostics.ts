export interface DiagnosticLogOptions {
  message: string;
  source?: string;
  help?: string[];
  timestamp?: string;
  details?: Record<string, unknown>;
}

export function buildDiagnosticLog(options: DiagnosticLogOptions): string {
  const payload: Record<string, unknown> = {
    timestamp: options.timestamp ?? new Date().toISOString(),
    message: options.message,
  };

  if (options.source) {
    payload.source = options.source;
  }

  if (options.help && options.help.length > 0) {
    payload.help = options.help;
  }

  if (options.details) {
    const details = sanitizeForLog(options.details);
    if (details && (!isPlainObject(details) || Object.keys(details as Record<string, unknown>).length > 0)) {
      payload.details = details;
    }
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    const fallbackLines = [
      `timestamp: ${String(payload.timestamp)}`,
      options.source ? `source: ${options.source}` : null,
      `message: ${options.message}`,
      ...(options.help ?? []),
      `serializationError: ${error instanceof Error ? error.message : String(error)}`,
    ].filter((line): line is string => !!line);
    return fallbackLines.join('\n');
  }
}

export function serializeError(error: unknown, seen: WeakSet<object> = new WeakSet()): Record<string, unknown> {
  if (error instanceof Error) {
    if (seen.has(error)) {
      return {
        name: error.name || 'Error',
        message: error.message,
        note: 'Circular reference detected in error cause.',
      };
    }
    seen.add(error);
    const result: Record<string, unknown> = {
      name: error.name || 'Error',
      message: error.message,
    };
    if (error.stack) {
      result.stack = error.stack;
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) {
      result.cause = sanitizeForLog(cause, seen);
    }
    const context = (error as { context?: unknown }).context;
    if (context !== undefined) {
      result.context = sanitizeForLog(context, seen);
    }
    const help = (error as { help?: unknown }).help;
    if (help !== undefined) {
      result.help = sanitizeForLog(help, seen);
    }
    return result;
  }

  return {
    value: sanitizeForLog(error, seen),
  };
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
    return serializeError(value, seen);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeForLog(entry, seen))
      .filter((entry) => entry !== undefined);
  }
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[Circular]';
    }
    seen.add(value as object);
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeForLog(val, seen);
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }
    return result;
  }
  if (typeof value === 'undefined') {
    return undefined;
  }
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
