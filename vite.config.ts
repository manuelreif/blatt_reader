/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { authGate, type AuthEnv } from './server/auth.ts'
import { memoryAttemptStore } from './server/loginLimit.ts'
import { handleTranslate, type TranslateEnv } from './server/translate.ts'

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

const toRequest = async (req: IncomingMessage, withBody: boolean) => {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: withBody && req.method === 'POST' ? await readBody(req) : undefined,
  })
}

const send = async (res: ServerResponse, response: Response) => {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value)
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length) res.setHeader('set-cookie', cookies)
  res.end(Buffer.from(await response.arrayBuffer()))
}

// Same handlers as the Cloudflare Pages Functions, mounted in the dev and preview server.
function devServerApi(env: TranslateEnv & AuthEnv): Plugin {
  const gate: Connect.NextHandleFunction = (req, res, next) => {
    if (!env.APP_PASSWORD) return next()
    // only the login form needs the body; other requests (e.g. /api/translate) keep their stream
    const isLogin = (req.url ?? '').split('?')[0] === '/login'
    void toRequest(req, isLogin)
      .then(request => authGate(request, env, { ip: req.socket.remoteAddress }))
      .then(async decision => {
        if ('response' in decision) return send(res, decision.response)
        if (decision.setCookie) res.setHeader('set-cookie', decision.setCookie)
        next()
      })
      .catch(next)
  }
  const translate: Connect.NextHandleFunction = (req, res, next) => {
    void toRequest(req, true)
      .then(request => handleTranslate(request, env))
      .then(response => send(res, response))
      .catch(next)
  }
  return {
    name: 'dev-server-api',
    configureServer(server) {
      server.middlewares.use(gate)
      server.middlewares.use('/api/translate', translate)
    },
    configurePreviewServer(server) {
      server.middlewares.use(gate)
      server.middlewares.use('/api/translate', translate)
    },
  }
}

// foliate-js renders book content in same-origin blob: iframes. A strict CSP keeps
// scripts embedded in EPUBs from running (see foliate-js README, "Security").
// Only in production: the Vite dev server needs inline scripts for hot reload.
// Google: login script (Identity Services) and the Drive REST API (src/drive/).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' blob: data:",
  "font-src 'self' blob: data:",
  "connect-src 'self' blob: data: https://www.googleapis.com https://accounts.google.com/gsi/",
  "frame-src 'self' blob: https://accounts.google.com/gsi/",
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
      devServerApi({
        DEEPL_API_KEY: env.DEEPL_API_KEY,
        APP_TOKEN: env.APP_TOKEN,
        DEEPL_API_URL: env.DEEPL_API_URL,
        APP_PASSWORD: env.APP_PASSWORD,
        // counts failed logins while the server runs (Cloudflare: KV binding)
        LOGIN_ATTEMPTS: memoryAttemptStore(),
      }),
      cspPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'brand/*.svg'],
        manifest: {
          name: 'Blatt-Reader',
          short_name: 'Blatt-Reader',
          description: 'EPUB- und PDF-Reader mit Übersetzung und Vokabeltrainer',
          lang: 'de',
          start_url: '/',
          display: 'standalone',
          background_color: '#f4efe3',
          theme_color: '#141f2d',
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
          // /login and /logout are answered by the password gate on the server, never from the cache
          navigateFallbackDenylist: [/^\/api\//, /^\/foliate-js\//, /^\/dict\//, /^\/login/, /^\/logout/],
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
