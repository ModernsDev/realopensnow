import { assets, points } from './generated.js'
import { stoweObservationPath, stoweObservations } from './stowe-observations.mjs'

const slotMs = 15 * 60 * 1000
const quota = 30

async function api(request, env, url) {
  const [, , route, point] = url.pathname.split('/')
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  if (request.headers.get('origin') !== url.origin) return new Response(null, { status: 403 })
  if (!points.has(point) || url.pathname !== `/api/${route}/${point}`) return new Response(null, { status: 404 })
  if (route === 'weather-error') {
    const kind = url.searchParams.get('kind')
    if (kind !== 'rate_limit' && kind !== 'request') return new Response(null, { status: 400 })
    console.warn(JSON.stringify({ event: 'forecast_client_error', point, kind }))
    return new Response(null, { status: 204 })
  }
  if (route !== 'quota') return new Response(null, { status: 404 })
  const now = Date.now()
  const slot = Math.floor(now / slotMs)
  try {
    const permit = await env.DB.prepare(
      'INSERT INTO weather_quota (id, slot, count) VALUES (1, ?, 1) ON CONFLICT(id) DO UPDATE SET slot = excluded.slot, count = CASE WHEN weather_quota.slot < excluded.slot THEN 1 ELSE weather_quota.count + 1 END WHERE weather_quota.slot < excluded.slot OR (weather_quota.slot = excluded.slot AND weather_quota.count < ?)'
    ).bind(slot, quota).run()
    if (permit.meta.changes) return new Response(null, { status: 204 })
    console.warn(JSON.stringify({ event: 'forecast_quota', point, status: 429 }))
    return new Response(null, { status: 429, headers: { 'retry-after': String(Math.ceil((slotMs - now % slotMs) / 1000)) } })
  } catch (error) {
    console.error(JSON.stringify({ event: 'forecast_quota', point, status: 503, reason: error.name }))
    return new Response(null, { status: 503 })
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === stoweObservationPath) {
      if (request.method !== 'GET') return new Response(null, { status: 405 })
      return stoweObservations()
    }
    if (url.pathname.startsWith('/api/')) return api(request, env, url)
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    const asset = assets.get(url.pathname)
    if (!asset) return new Response('Not found', { status: 404 })
    const [type, base64] = asset
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(base64), character => character.charCodeAt(0)), {
      headers: {
        'content-type': type,
        'cache-control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
      },
    })
  },
}
