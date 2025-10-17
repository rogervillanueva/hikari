// Temporary stub for morphology diagnostics
export const buildDiagnosticLog = (data: any) => {
  return JSON.stringify(data);
};

export const serializeError = (error: any) => {
  return {
    message: error?.message || 'Unknown error',
    stack: error?.stack || null
  };
};