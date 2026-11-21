// Cloudflare Pages middleware: runs before every request, static files included.
// Password protection is on as soon as the secret APP_PASSWORD is set.
import { authGate, type AuthEnv } from '../server/auth'

export const onRequest = async (context: { request: Request; env: AuthEnv; next: () => Promise<Response> }) => {
  const decision = await authGate(context.request, context.env)
  if ('response' in decision) return decision.response
  const response = await context.next()
  if (!decision.setCookie) return response
  const renewed = new Response(response.body, response)
  renewed.headers.append('set-cookie', decision.setCookie)
  return renewed
}
