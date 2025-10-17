import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { logs } = body;
    
    if (!logs || !Array.isArray(logs)) {
      return NextResponse.json({ error: 'Invalid logs format' }, { status: 400 });
    }
    
    // Ensure logs directory exists
    const logsDir = join(process.cwd(), '.logs');
    try {
      await mkdir(logsDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
    
    // Write to reader-debug.log
    const logPath = join(logsDir, 'reader-debug.log');
    
    for (const logEntry of logs) {
      const logLine = JSON.stringify(logEntry) + '\n';
      await writeFile(logPath, logLine, { flag: 'a' });
    }
    
    return NextResponse.json({ success: true, count: logs.length });
  } catch (error) {
    console.error('Failed to write reader debug logs:', error);
    return NextResponse.json({ error: 'Failed to log' }, { status: 500 });
  }
}