import { defineConfig, devices } from '@playwright/test'

// E2E_PREVIEW=1 runs the tests against the production build (with CSP and service worker)
const preview = !!process.env.E2E_PREVIEW
const port = preview ? 4179 : 5179
/** the production build runs behind the password gate (server/auth.ts) */
export const E2E_PASSWORD = 'e2e-password'
/** shows the Google Drive features in the dev server; the tests replace Google with a stub (e2e/drive.spec.ts) */
const E2E_GOOGLE_CLIENT_ID = 'e2e-client.apps.googleusercontent.com'

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/make-fixtures.mjs',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    permissions: ['clipboard-read', 'clipboard-write'],
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: preview ? 'npx vite preview --port 4179 --strictPort' : 'npx vite --port 5179 --strictPort',
    url: `http://localhost:${port}`,
    reuseExistingServer: !preview,
    // the preview serves dist/ as built: Drive tests only run if that build had VITE_GOOGLE_CLIENT_ID
    env: preview ? { APP_PASSWORD: E2E_PASSWORD } : { VITE_GOOGLE_CLIENT_ID: process.env.VITE_GOOGLE_CLIENT_ID ?? E2E_GOOGLE_CLIENT_ID },
  },
})
