import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lines = parseInt(searchParams.get('lines') || '50');
    
    const logPath = join(process.cwd(), '.logs', 'audio-debug.log');
    
    try {
      const content = await readFile(logPath, 'utf-8');
      const logLines = content.trim().split('\n').filter(line => line.trim());
      
      // Get the last N lines
      const recentLines = logLines.slice(-lines);
      
      // Parse each line as JSON
      const parsedLogs = recentLines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
      
      return NextResponse.json({ logs: parsedLogs });
    } catch (error) {
      // File doesn't exist yet
      return NextResponse.json({ logs: [] });
    }
  } catch (error) {
    console.error('Failed to read audio debug logs:', error);
    return NextResponse.json({ error: 'Failed to read logs' }, { status: 500 });
  }
}