import { betterAuth } from 'better-auth'
import { resorts } from '../src/catalog.ts'
import { validLocation } from '../src/customLocations.ts'
import { validHidden, validWeights } from '../src/weights.ts'
import { validUnits } from '../src/units.ts'
import { validChartLayers } from '../src/chartLayers.ts'
import { validForecastRange } from '../src/forecastRange.ts'

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
  if (typeof data !== 'object' || data === null || Object.keys(data).length !== 7) return false
  const { favorites, customLocations, weights, hidden, units, chartLayers, forecastRange } = data
  if (!Array.isArray(customLocations) || customLocations.length > 200 || !customLocations.every(validLocation)) return false
  const ids = new Set([...resortIds, ...customLocations.map(l => l.id)])
  if (new Set(customLocations.map(l => l.id)).size !== customLocations.length) return false
  return Array.isArray(favorites) && favorites.length <= ids.size && new Set(favorites).size === favorites.length &&
    favorites.every(id => typeof id === 'string' && ids.has(id)) && validWeights(weights) && validHidden(hidden) && validUnits(units) && validChartLayers(chartLayers) && validForecastRange(forecastRange)
}

export async function me(request, env, url) {
  const session = await auth(env, url.origin).api.getSession({ headers: request.headers })
  if (!session) return json({ error: 'unauthenticated' }, 401)
  const userId = session.user.id
  if (request.method === 'GET') {
    const [settings, favorites, locations] = await env.DB.batch([
      env.DB.prepare('SELECT units, weights, hidden_models, chart_layers, forecast_range FROM user_settings WHERE user_id = ?').bind(userId),
      env.DB.prepare('SELECT resort_id FROM user_favorites WHERE user_id = ? ORDER BY position').bind(userId),
      env.DB.prepare('SELECT id, name, lat, lon, elevation, timezone, created_on FROM user_locations WHERE user_id = ? ORDER BY position').bind(userId),
    ])
    const row = settings.results[0]
    const { name, email, image } = session.user
    return json({ user: { name, email, image: image ?? null }, data: row ? {
      favorites: favorites.results.map(f => f.resort_id),
      customLocations: locations.results.map(({ created_on, ...l }) => ({ ...l, createdOn: created_on })),
      weights: JSON.parse(row.weights),
      hidden: JSON.parse(row.hidden_models),
      units: JSON.parse(row.units),
      chartLayers: JSON.parse(row.chart_layers),
      forecastRange: JSON.parse(row.forecast_range),
    } : null })
  }
  if (request.method !== 'PUT') return new Response(null, { status: 405 })
  if (request.headers.get('origin') !== url.origin) return new Response(null, { status: 403 })
  const text = await request.text()
  if (text.length > 200000) return new Response(null, { status: 413 })
  let data
  try { data = JSON.parse(text) } catch { return new Response(null, { status: 400 }) }
  if (!validUserData(data)) return new Response(null, { status: 400 })
  await env.DB.batch([
    env.DB.prepare('INSERT INTO user_settings (user_id, units, weights, hidden_models, chart_layers, forecast_range, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT (user_id) DO UPDATE SET units = ?2, weights = ?3, hidden_models = ?4, chart_layers = ?5, forecast_range = ?6, updated_at = ?7')
      .bind(userId, JSON.stringify(data.units), JSON.stringify(data.weights), JSON.stringify(data.hidden), JSON.stringify(data.chartLayers), JSON.stringify(data.forecastRange), Date.now()),
    env.DB.prepare('DELETE FROM user_favorites WHERE user_id = ?').bind(userId),
    env.DB.prepare('INSERT INTO user_favorites (user_id, resort_id, position) SELECT ?1, value, key FROM json_each(?2)').bind(userId, JSON.stringify(data.favorites)),
    env.DB.prepare('DELETE FROM user_locations WHERE user_id = ?').bind(userId),
    env.DB.prepare(`INSERT INTO user_locations (user_id, id, position, name, lat, lon, elevation, timezone, created_on)
      SELECT ?1, value ->> '$.id', key, value ->> '$.name', value ->> '$.lat', value ->> '$.lon', value ->> '$.elevation', value ->> '$.timezone', value ->> '$.createdOn' FROM json_each(?2)`)
      .bind(userId, JSON.stringify(data.customLocations)),
  ])
  return new Response(null, { status: 204 })
}
