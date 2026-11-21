// Google login per device with Google Identity Services, token model: runs in the
// browser only, no client secret. An access token lives about an hour; a new one
// needs a user gesture (it opens a popup), so background syncs only run while the
// last token is still valid (see driveSync.ts).

export const GIS_URL = 'https://accounts.google.com/gsi/client'

/** read the books folder, write only files the app created itself (no permission to delete anything) */
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file']

const TOKEN_KEY = 'vr_google_token'
/** a token with less time left is not used for a sync that may take a while */
const MIN_LEFT_MS = 2 * 60 * 1000

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }): TokenClient
  hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean
  revoke(token: string, done?: () => void): void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } }
  }
}

export class DriveAuthError extends Error {}

export const googleClientId = (): string => (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()

/** false: the build has no VITE_GOOGLE_CLIENT_ID, the Drive features stay hidden */
export const driveConfigured = (): boolean => !!googleClientId()

interface StoredToken {
  accessToken: string
  expiresAt: number
}

/** The last access token if it is still valid for a few minutes, else null. Kept out of db.settings so it never lands in a backup. */
export function storedToken(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as StoredToken
    return t.expiresAt - now > MIN_LEFT_MS ? t.accessToken : null
  } catch {
    return null
  }
}

export function forgetToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage blocked: nothing to forget
  }
}

let gis: Promise<GoogleOAuth2> | null = null

/** Loads the Google script once. Called early (preloadGis) so a tap opens the popup without delay. */
function loadGis(): Promise<GoogleOAuth2> {
  gis ??= new Promise<GoogleOAuth2>((resolve, reject) => {
    const ready = () => window.google?.accounts?.oauth2
    if (ready()) return resolve(ready()!)
    const script = document.createElement('script')
    script.src = GIS_URL
    script.async = true
    script.onload = () => (ready() ? resolve(ready()!) : reject(new DriveAuthError('Google-Anmeldung konnte nicht geladen werden')))
    script.onerror = () => reject(new DriveAuthError('Google-Anmeldung nicht erreichbar (offline?)'))
    document.head.append(script)
  }).catch(e => {
    // try again with a fresh script next time (e.g. once back online)
    gis = null
    document.querySelectorAll(`script[src="${GIS_URL}"]`).forEach(s => s.remove())
    throw e
  })
  return gis
}

export function preloadGis() {
  if (driveConfigured()) void loadGis().catch(() => {})
}

const POPUP_ERRORS: Record<string, string> = {
  popup_closed: 'Google-Anmeldung abgebrochen',
  popup_failed_to_open: 'Das Anmelde-Fenster wurde blockiert – bitte Popups für diese Seite erlauben',
}

/**
 * Asks Google for a new access token. Must run right after a tap or click: browsers
 * only open the popup during a user gesture. Without an active Google session or on
 * first use the popup asks for the account and the Drive permissions.
 */
export async function requestToken(): Promise<string> {
  const oauth2 = await loadGis()
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: googleClientId(),
      scope: DRIVE_SCOPES.join(' '),
      callback: response => {
        if (response.error || !response.access_token)
          return reject(new DriveAuthError(`Google-Anmeldung fehlgeschlagen${response.error ? ` (${response.error})` : ''}`))
        if (!oauth2.hasGrantedAllScopes(response, ...DRIVE_SCOPES))
          return reject(new DriveAuthError('Bitte beide Google-Drive-Berechtigungen erlauben (Lesen und eigene Dateien)'))
        const expiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000
        try {
          localStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: response.access_token, expiresAt } satisfies StoredToken))
        } catch {
          // storage blocked: the token still works for this sync
        }
        resolve(response.access_token)
      },
      error_callback: error =>
        reject(new DriveAuthError(POPUP_ERRORS[error.type ?? ''] ?? `Google-Anmeldung fehlgeschlagen${error.type ? ` (${error.type})` : ''}`)),
    })
    // empty prompt: no questions if the user already agreed and is signed in to Google
    client.requestAccessToken({ prompt: '' })
  })
}

/** Forgets the token on this device and withdraws it at Google if it is still valid. */
export async function revokeToken() {
  const token = storedToken(0) // also an expired one: nothing to lose by trying
  forgetToken()
  if (!token) return
  try {
    const oauth2 = await loadGis()
    await new Promise<void>(resolve => oauth2.revoke(token, resolve))
  } catch {
    // offline: the token expires within the hour anyway
  }
}
