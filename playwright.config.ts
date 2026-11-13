import { defineConfig } from '@playwright/test';

// Runs against the production build served locally (no internet needed).
// Set CHROME_PATH to use an installed Chrome instead of Playwright's bundled browser.
const executablePath = process.env.CHROME_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 2,
  reporter: [['list'], ['json', { outputFile: 'qa/e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1600, height: 900 },
    launchOptions: {
      executablePath,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: [
    { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true },
    { command: 'node relay/server.mjs', url: 'http://localhost:8787', reuseExistingServer: true, env: { PORT: '8787' } },
  ],
});
