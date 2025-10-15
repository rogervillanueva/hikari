import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  testDir: './tests/e2e',
  retries: 0,
  use: {
    headless: true,
    baseURL: 'http://localhost:3000'
  }
};

export default config;
