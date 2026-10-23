import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:4173${process.env.TEST_BASE_PATH || '/'}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npm run ${process.env.TEST_PRODUCTION ? 'preview' : 'dev'} -- --port 4173 --strictPort`,
    url: `http://127.0.0.1:4173${process.env.TEST_BASE_PATH || '/'}`,
    env: { BASE_PATH: process.env.TEST_BASE_PATH || '/' },
    reuseExistingServer: !process.env.CI,
  },
});
