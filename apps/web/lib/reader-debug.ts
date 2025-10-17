import { isDebugEnabled } from './debug-config';

// Comprehensive logging utility for the entire reader system
let logQueue: any[] = [];
let isFlushingLogs = false;

interface LogEntry {
  timestamp: string;
  component: string;
  event: string;
  data: any;
  userAgent?: string;
  sessionId?: string;
}

// Generate a session ID for this browser session
const sessionId = typeof window !== 'undefined' 
  ? `${Date.now()}-${Math.random().toString(36).substr(2, 9)}` 
  : 'server';

export const logReaderEvent = async (component: string, event: string, data: any) => {
  if (typeof window === 'undefined') return; // Server-side, skip
  if (!isDebugEnabled('READER')) return; // Debug disabled
  
  // Log to console for immediate visibility
  console.log(`[READER] ${component}.${event}:`, data);
  
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    component,
    event,
    data,
    userAgent: navigator.userAgent,
    sessionId
  };

  logQueue.push(logEntry);
  
  // Flush logs every 2 seconds or when queue gets large
  if (!isFlushingLogs && (logQueue.length >= 10 || Math.random() < 0.1)) {
    flushLogs();
  }
};

const flushLogs = async () => {
  if (isFlushingLogs || logQueue.length === 0 || !isDebugEnabled('READER')) return;
  
  isFlushingLogs = true;
  const logsToFlush = [...logQueue];
  logQueue = [];
  
  try {
    await fetch('/api/debug/reader', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        logs: logsToFlush
      })
    });
  } catch (error) {
    console.error('Failed to flush reader logs:', error);
    // Put logs back in queue if failed
    logQueue.unshift(...logsToFlush);
  } finally {
    isFlushingLogs = false;
  }
};

// Flush logs on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (logQueue.length > 0) {
      // Synchronous flush on unload
      navigator.sendBeacon('/api/debug/reader', JSON.stringify({ logs: logQueue }));
    }
  });
  
  // Periodic flush
  setInterval(flushLogs, 2000);
}