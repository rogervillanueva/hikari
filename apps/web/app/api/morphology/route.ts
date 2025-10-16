import { NextResponse } from 'next/server';
import { tokenizeJapaneseServer } from '@/lib/morphology/server';
import { SudachiUnavailableError } from '@/lib/sudachi/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_MORPHOLOGY_API_KEY) {
    const headerKey = request.headers.get('x-api-key');
    if (!headerKey || headerKey !== process.env.NEXT_PUBLIC_MORPHOLOGY_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const text = typeof body === 'object' && body !== null ? (body as { text?: unknown }).text : undefined;
  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'text is required.' }, { status: 400 });
  }

  const trimmed = text.trim();
  if (!trimmed.length) {
    return NextResponse.json({ tokens: [] });
  }

  try {
    const { tokens, source, diagnostics } = await tokenizeJapaneseServer(trimmed);
    return NextResponse.json({ tokens, source, diagnostics });
  } catch (error) {
    if (error instanceof SudachiUnavailableError) {
      return NextResponse.json(
        { error: error.message, help: error.help, context: error.context },
        { status: 503 },
      );
    }
    console.error('[api/morphology] unexpected error', error);
    return NextResponse.json({ error: 'Failed to tokenize text.' }, { status: 500 });
  }
}
