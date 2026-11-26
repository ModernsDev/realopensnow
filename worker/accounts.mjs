import { betterAuth } from 'better-auth'
import { resorts } from '../src/catalog.ts'
import { validLocation } from '../src/customLocations.ts'
import { validHidden, validWeights } from '../src/weights.ts'
import { validUnits } from '../src/units.ts'

const resortIds = new Set(resorts.map(r => r.id))
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } })

export const auth = (env, origin) => betterAuth({
  database: env.DB,
  baseURL: origin,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  socialProviders: { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: 'select_account' } },
  telemetry: { enabled: false },
})

export function validUserData(data) {
  if (typeof data !== 'object' || data === null || Object.keys(data).length !== 5) return false
  const { favorites, customLocations, weights, hidden, units } = data
  if (!Array.isArray(customLocations) || customLocations.length > 200 || !customLocations.every(validLocation)) return false
  const ids = new Set([...resortIds, ...customLocations.map(l => l.id)])
  if (new Set(customLocations.map(l => l.id)).size !== customLocations.length) return false
  return Array.isArray(favorites) && favorites.length <= ids.size && new Set(favorites).size === favorites.length &&
    favorites.every(id => typeof id === 'string' && ids.has(id)) && validWeights(weights) && validHidden(hidden) && validUnits(units)
}

export async function me(request, env, url) {
  const session = await auth(env, url.origin).api.getSession({ headers: request.headers })
  if (!session) return json({ error: 'unauthenticated' }, 401)
  const userId = session.user.id
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT payload FROM user_data WHERE user_id = ?').bind(userId).first()
    const { name, email, image } = session.user
    return json({ user: { name, email, image: image ?? null }, data: row ? JSON.parse(row.payload) : null })
  }
  if (request.method !== 'PUT') return new Response(null, { status: 405 })
  if (request.headers.get('origin') !== url.origin) return new Response(null, { status: 403 })
  const text = await request.text()
  if (text.length > 200000) return new Response(null, { status: 413 })
  let data
  try { data = JSON.parse(text) } catch { return new Response(null, { status: 400 }) }
  if (!validUserData(data)) return new Response(null, { status: 400 })
  await env.DB.prepare('INSERT INTO user_data (user_id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET payload = ?2, updated_at = ?3')
    .bind(userId, JSON.stringify(data), Date.now()).run()
  return new Response(null, { status: 204 })
}
