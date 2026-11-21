import { defineConfig, devices } from '@playwright/test'

// E2E_PREVIEW=1 runs the tests against the production build (with CSP and service worker)
const preview = !!process.env.E2E_PREVIEW
const port = preview ? 4179 : 5179

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
  },
})
