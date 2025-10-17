import { isDebugEnabled } from './debug-config';

// Audio debugging utility for server-side logging
export const logAudioDebug = async (event: string, data: any) => {
  if (typeof window === 'undefined') return; // Server-side, skip
  if (!isDebugEnabled('AUDIO')) return; // Debug disabled
  
  // Log to console for immediate visibility
  console.log(`[AUDIO] ${event}:`, data);
  
  try {
    await fetch('/api/debug/audio', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event,
        data,
        timestamp: new Date().toISOString()
      })
    });
  } catch (error) {
    console.error('Failed to log audio debug:', error);
  }
};