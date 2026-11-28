import { assets, points } from './generated.js'
import { stoweObservationPath, stoweObservations } from './stowe-observations.mjs'
import { captureSnapshot, refreshFavorites, snapshotHistory, stationAccuracy } from './forecast-snapshots.mjs'
import { auth, me } from './accounts.mjs'

async function api(request, env, url) {
  const [, , route, point] = url.pathname.split('/')
  if (!points.has(point) || url.pathname !== `/api/${route}/${point}`) return new Response(null, { status: 404 })
  const en = request.headers.get('accept-language') === 'en'
  if (request.method === 'GET' && route === 'forecast-snapshots') return snapshotHistory(env, point, url.searchParams, en)
  if (request.method === 'GET' && route === 'forecast-accuracy') return stationAccuracy(env, point, en)
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  if (request.headers.get('origin') !== url.origin) return new Response(null, { status: 403 })
  if (route === 'weather-error') {
    const kind = url.searchParams.get('kind')
    if (kind !== 'rate_limit' && kind !== 'request') return new Response(null, { status: 400 })
    console.warn(JSON.stringify({ event: 'forecast_client_error', point, kind }))
    return new Response(null, { status: 204 })
  }
  if (route === 'forecast-snapshots') return captureSnapshot(env, point, en)
  return new Response(null, { status: 404 })
}

export default {
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshFavorites(env))
  },
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === stoweObservationPath) {
      if (request.method !== 'GET') return new Response(null, { status: 405 })
      return stoweObservations()
    }
    if (url.pathname.startsWith('/api/auth/')) return auth(env, url.origin).handler(request)
    if (url.pathname === '/api/me') return me(request, env, url)
    if (url.pathname.startsWith('/api/')) return api(request, env, url)
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    const asset = assets.get(url.pathname)
    if (!asset) return new Response('Not found', { status: 404 })
    const [type, base64] = asset
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(base64), character => character.charCodeAt(0)), {
      headers: {
        'content-type': type,
        'cache-control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'private, no-cache',
        'x-content-type-options': 'nosniff',
      },
    })
  },
}
