// Cloudflare Pages Function: POST /api/translate
// Secrets im Cloudflare-Dashboard setzen: DEEPL_API_KEY, APP_TOKEN (optional, empfohlen).
import { handleTranslate, type TranslateEnv } from '../../server/translate'

export const onRequest = (context: { request: Request; env: TranslateEnv }) =>
  handleTranslate(context.request, context.env)
