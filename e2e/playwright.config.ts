import { defineConfig, devices } from '@playwright/test';

// Runs against an Outpost that is already running, usually the Docker image started in CI:
// OUTPOST_E2E_URL (default http://localhost:3000) and OUTPOST_E2E_SETUP_TOKEN must match it.
export default defineConfig({
  testDir: './tests',
  // The tests share one instance and build on each other (setup, then login).
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['OUTPOST_E2E_URL'] ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
