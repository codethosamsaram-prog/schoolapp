import { defineConfig, devices } from '@playwright/test';
import {
  APP_PORT,
  E2E_RAZORPAY_KEY_ID,
  E2E_WEBHOOK_SECRET,
  MOCK_GATEWAY_URL,
  MOCK_PORT,
} from './e2e/constants';

/**
 * End-to-end suite. Runs against the local Supabase stack (`supabase start`)
 * and a dedicated Next dev server on APP_PORT, whose Razorpay and WhatsApp
 * traffic goes to e2e/mock-gateway.mjs instead of the real services.
 *
 * Tests share one database, so they run serially. e2e/global-setup.ts resets
 * the E2E-prefixed fixtures before every run; seed data is left alone.
 */

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 90_000,
    actionTimeout: 20_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mock-gateway.mjs',
      url: `${MOCK_GATEWAY_URL}/__health`,
      reuseExistingServer: false,
      env: { MOCK_GATEWAY_PORT: String(MOCK_PORT) },
    },
    {
      command: `npx next dev -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/login`,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_PUBLIC_APP_URL: `http://localhost:${APP_PORT}`,
        RAZORPAY_KEY_ID: E2E_RAZORPAY_KEY_ID,
        NEXT_PUBLIC_RAZORPAY_KEY_ID: E2E_RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET: 'e2e_key_secret',
        RAZORPAY_WEBHOOK_SECRET: E2E_WEBHOOK_SECRET,
        RAZORPAY_API_BASE_URL: MOCK_GATEWAY_URL,
        WHATSAPP_PROVIDER: 'meta',
        WHATSAPP_ACCESS_TOKEN: 'e2e-token',
        WHATSAPP_PHONE_NUMBER_ID: '1000000001',
        WHATSAPP_BUSINESS_ACCOUNT_ID: '2000000002',
        WHATSAPP_GRAPH_BASE_URL: MOCK_GATEWAY_URL,
      },
    },
  ],
});
