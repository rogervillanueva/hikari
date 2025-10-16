import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';

import { getLatestLogFile, logServerEvent } from '@/lib/logging/server';
import { serializeError } from '@/lib/morphology/diagnostics';

export const runtime = 'nodejs';

function getServerLogApiKey(): string | undefined {
  return process.env.SERVER_LOG_API_KEY ?? process.env.NEXT_PUBLIC_SERVER_LOG_API_KEY;
}

export async function GET(request: Request) {
  const serverKey = getServerLogApiKey();
  if (serverKey) {
    const headerKey = request.headers.get('x-api-key');
    if (!headerKey || headerKey !== serverKey) {
      await logServerEvent({
        level: 'warn',
        category: 'logs',
        message: 'Unauthorized log download attempt.',
        details: { hasHeader: Boolean(headerKey) },
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const latest = await getLatestLogFile();
  if (!latest) {
    await logServerEvent({ level: 'info', category: 'logs', message: 'Log download requested but no logs available.' });
    return NextResponse.json({ error: 'No logs available.' }, { status: 404 });
  }

  try {
    const data = await fs.readFile(latest.path, 'utf8');
    await logServerEvent({
      level: 'info',
      category: 'logs',
      message: 'Served latest log file.',
      details: { file: latest.name, size: data.length },
    });
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${latest.name}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    await logServerEvent({
      level: 'error',
      category: 'logs',
      message: 'Failed to read latest log file.',
      details: { file: latest.name, error: serializeError(error) },
    });
    return NextResponse.json({ error: 'Failed to read log file.' }, { status: 500 });
  }
}
