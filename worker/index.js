import { assets, points } from './generated.js'
import { localDate } from './weather.js'

const slotMs = 15 * 60 * 1000
const cacheMs = 4 * slotMs
const store = 'SELECT slot, status, fetched, body FROM forecast_cache WHERE point = ?'

function weatherResponse(status, body, fetched) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' }
  if (fetched) headers['x-weather-fetched-at'] = fetched
  return new Response(body ?? JSON.stringify({ error: true }), { status, headers })
}

async function weather(env, point) {
  const { id, timezone, source } = point
  const now = Date.now()
  const slot = Math.floor(now / slotMs)
  const cached = await env.DB.prepare(store).bind(id).first()
  if (cached?.status === 200 && now - Date.parse(cached.fetched) < cacheMs &&
      localDate(now, timezone) === localDate(Date.parse(cached.fetched), timezone)) {
    return weatherResponse(200, cached.body, cached.fetched)
  }
  if (cached?.slot >= slot) return weatherResponse(cached.status === 200 ? 503 : cached.status)

  const reservation = await env.DB.prepare(
    'INSERT INTO forecast_cache (point, slot, status) VALUES (?, ?, 503) ON CONFLICT(point) DO UPDATE SET slot = excluded.slot, status = 503, fetched = NULL, body = NULL WHERE forecast_cache.slot < excluded.slot'
  ).bind(id, slot).run()
  if (!reservation.meta.changes) return weatherResponse(503)

  let status = 502
  let fetched
  let body
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const upstream = await fetch(source, { signal: controller.signal, redirect: 'manual' })
    status = upstream.status === 429 ? 429 : 502
    if (upstream.ok) {
      const data = await upstream.json()
      if (!data.error && data.timezone === timezone && Array.isArray(data.hourly?.time)) {
        body = JSON.stringify(data)
        fetched = new Date().toISOString()
        status = 200
      }
    }
    console[status === 200 ? 'info' : 'warn'](JSON.stringify({ event: 'forecast_refresh', point: id, upstream: upstream.status, status }))
  } catch (error) {
    console.warn(JSON.stringify({ event: 'forecast_refresh', point: id, status, reason: error.message }))
  } finally {
    clearTimeout(timeout)
  }

  await env.DB.prepare('UPDATE forecast_cache SET status = ?, fetched = ?, body = ? WHERE point = ? AND slot = ?')
    .bind(status, fetched ?? null, body ?? null, id, slot).run()
  return weatherResponse(status, body, fetched)
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/forecast/')) {
      if (request.method !== 'GET') return new Response(null, { status: 405 })
      const point = points.get(pathname.slice('/api/forecast/'.length))
      if (!point) return weatherResponse(404)
      try {
        return await weather(env, point)
      } catch (error) {
        console.error(JSON.stringify({ event: 'forecast_storage_error', point: point.id, reason: error.name }))
        return weatherResponse(503)
      }
    }
    const asset = assets.get(pathname)
    if (!asset) return new Response('Not found', { status: 404 })
    const [type, base64] = asset
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(base64), character => character.charCodeAt(0)), {
      headers: {
        'content-type': type,
        'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
      },
    })
  },
}
