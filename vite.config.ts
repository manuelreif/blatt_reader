/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleTranslate, type TranslateEnv } from './server/translate.ts'

// Same handler as the Cloudflare Pages Function, mounted in the dev server.
function devTranslateApi(env: TranslateEnv): Plugin {
  const toRequest = async (req: IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
    return new Request('http://localhost/api/translate', {
      method: req.method,
      headers,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    })
  }
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const response = await handleTranslate(await toRequest(req), env)
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    res.end(Buffer.from(await response.arrayBuffer()))
  }
  return {
    name: 'dev-translate-api',
    configureServer(server) {
      server.middlewares.use('/api/translate', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/translate', handler)
    },
  }
}

// foliate-js renders book content in same-origin blob: iframes. A strict CSP keeps
// scripts embedded in EPUBs from running (see foliate-js README, "Security").
// Only in production: the Vite dev server needs inline scripts for hot reload.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' blob: data:",
  "font-src 'self' blob: data:",
  "connect-src 'self' blob: data:",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

const cspPlugin = (): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
  ],
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      devTranslateApi({ DEEPL_API_KEY: env.DEEPL_API_KEY, APP_TOKEN: env.APP_TOKEN, DEEPL_API_URL: env.DEEPL_API_URL }),
      cspPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Vokabel-Reader',
          short_name: 'Vokabeln',
          description: 'EPUB- und PDF-Reader mit Übersetzung und Vokabeltrainer',
          lang: 'de',
          start_url: '/',
          display: 'standalone',
          background_color: '#f7f5f0',
          theme_color: '#2f6f5e',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest,bcmap,pfb,ttf}'],
          globIgnores: ['dict/**', 'foliate-js/tests/**', 'foliate-js/rollup/**', '**/*.map'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/api\//, /^\/foliate-js\//, /^\/dict\//],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/dict/'),
              handler: 'CacheFirst',
              options: { cacheName: 'dict', expiration: { maxEntries: 800 } },
            },
          ],
        },
      }),
    ],
    server: { host: true },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  }
})
