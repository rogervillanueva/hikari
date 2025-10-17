import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event, data, timestamp = new Date().toISOString() } = body;
    
    const logEntry = {
      timestamp,
      event,
      data,
      userAgent: request.headers.get('user-agent'),
      url: request.url
    };
    
    // Ensure logs directory exists
    const logsDir = join(process.cwd(), '.logs');
    console.log('[DEBUG] Logs directory:', logsDir);
    
    try {
      await mkdir(logsDir, { recursive: true });
      console.log('[DEBUG] Created logs directory');
    } catch (error) {
      console.log('[DEBUG] Directory exists or error creating:', error);
    }
    
    // Write to audio-debug.log
    const logPath = join(logsDir, 'audio-debug.log');
    const logLine = JSON.stringify(logEntry) + '\n';
    
    console.log('[DEBUG] Writing to:', logPath);
    console.log('[DEBUG] Log entry:', logLine);
    
    await writeFile(logPath, logLine, { flag: 'a' });
    console.log('[DEBUG] File written successfully');
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to write audio debug log:', error);
    return NextResponse.json({ error: 'Failed to log' }, { status: 500 });
  }
}