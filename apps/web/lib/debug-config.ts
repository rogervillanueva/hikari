// Centralized debug configuration
// Set these flags to enable/disable different types of logging

export const DEBUG_CONFIG = {
  // Audio debugging - logs audio events, playback state, etc.
  AUDIO: false,
  
  // Reader debugging - logs component events, user interactions, etc.
  READER: false,
  
  // General app debugging
  APP: false,
  
  // Force enable all debugging (useful during development)
  FORCE_ALL: false,
} as const;

// Helper to check if a debug type is enabled
export const isDebugEnabled = (type: keyof typeof DEBUG_CONFIG): boolean => {
  if (DEBUG_CONFIG.FORCE_ALL) return true;
  return DEBUG_CONFIG[type];
};

// Easy way to enable/disable all debugging
export const enableAllDebugging = () => {
  Object.keys(DEBUG_CONFIG).forEach(key => {
    if (key !== 'FORCE_ALL') {
      (DEBUG_CONFIG as any)[key] = true;
    }
  });
};

export const disableAllDebugging = () => {
  Object.keys(DEBUG_CONFIG).forEach(key => {
    (DEBUG_CONFIG as any)[key] = false;
  });
};