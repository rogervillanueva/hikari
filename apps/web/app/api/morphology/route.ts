import { NextResponse } from 'next/server';
import { logServerEvent } from '@/lib/logging/server';
import { serializeError } from '@/lib/morphology/diagnostics';
import { tokenizeJapaneseServer } from '@/lib/morphology/server';
import { SudachiUnavailableError } from '@/lib/sudachi/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_MORPHOLOGY_API_KEY) {
    const headerKey = request.headers.get('x-api-key');
    if (!headerKey || headerKey !== process.env.NEXT_PUBLIC_MORPHOLOGY_API_KEY) {
      await logServerEvent({
        level: 'warn',
        category: 'morphology-api',
        message: 'Rejected morphology request due to invalid API key.',
        details: { hasHeader: Boolean(headerKey) },
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    await logServerEvent({
      level: 'error',
      category: 'morphology-api',
      message: 'Failed to parse morphology request body.',
      details: { error: serializeError(error) },
    });
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const text = typeof body === 'object' && body !== null ? (body as { text?: unknown }).text : undefined;
  if (typeof text !== 'string') {
    await logServerEvent({
      level: 'warn',
      category: 'morphology-api',
      message: 'Rejected morphology request without text payload.',
    });
    return NextResponse.json({ error: 'text is required.' }, { status: 400 });
  }

  const trimmed = text.trim();
  if (!trimmed.length) {
    await logServerEvent({
      level: 'info',
      category: 'morphology-api',
      message: 'Handled empty morphology request.',
    });
    return NextResponse.json({ tokens: [] });
  }

  try {
    const { tokens, source, diagnostics } = await tokenizeJapaneseServer(trimmed);
    await logServerEvent({
      level: 'info',
      category: 'morphology-api',
      message: 'Served morphology request.',
      details: {
        source,
        tokenCount: tokens.length,
        diagnostics: diagnostics.map((entry) => ({
          level: entry.level,
          message: entry.message,
          source: entry.source,
        })),
      },
    });
    return NextResponse.json({ tokens, source, diagnostics });
  } catch (error) {
    if (error instanceof SudachiUnavailableError) {
      await logServerEvent({
        level: 'error',
        category: 'morphology-api',
        message: 'Morphology request failed: Sudachi unavailable.',
        details: { error: serializeError(error) },
      });
      return NextResponse.json(
        { error: error.message, help: error.help, context: error.context },
        { status: 503 },
      );
    }
    await logServerEvent({
      level: 'error',
      category: 'morphology-api',
      message: 'Unexpected morphology API error.',
      details: { error: serializeError(error) },
    });
    return NextResponse.json({ error: 'Failed to tokenize text.' }, { status: 500 });
  }
}
