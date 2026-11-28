import { assets, points } from './generated.js'
import { stoweObservationPath, stoweObservations } from './stowe-observations.mjs'
import { captureSnapshot, snapshotHistory, stationAccuracy } from './forecast-snapshots.mjs'
import { latestForecast } from './forecast-store.mjs'
import { auth, me } from './accounts.mjs'
import { forwardWeather, trackedPoints, weatherRoutes } from './backend.mjs'

async function api(request, env, ctx, url, routes) {
  const get = request.method === 'GET'
  const forward = (params = [], forecastPoint) => forwardWeather(request, env, ctx, url, params, forecastPoint)
  if (get && routes.has('ondemand')) {
    if (url.pathname === '/api/forecast') return forward(['lat', 'lon', 'elevation', 'timezone', 'resortId', 'pointId'])
    if (url.pathname === '/api/location') return forward(['lat', 'lon'])
  }
  if (get && routes.has('regions') && url.pathname === '/api/regions/north-america') return forward()
  const [, , route, point] = url.pathname.split('/')
  if (!points.has(point) || url.pathname !== `/api/${route}/${point}`) return new Response(null, { status: 404 })
  const en = request.headers.get('accept-language') === 'en'
  if (get && route === 'forecast') return routes.has('catalog') ? forward([], point) : latestForecast(env, point)
  if (get && route === 'forecast-snapshots') return routes.has('snapshots') ? forward(['before']) : snapshotHistory(env, point, url.searchParams, en)
  if (get && route === 'forecast-accuracy') return routes.has('snapshots') ? forward() : stationAccuracy(env, point, en)
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  if (route === 'forecast-snapshots' && env.SNAPSHOT_WRITES === 'frozen') return Response.json({ error: en ? 'Saving snapshots is paused. Please try again later.' : '快照保存暂时关闭，请稍后再试。' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  if (request.headers.get('origin') !== url.origin) return new Response(null, { status: 403 })
  if (route === 'weather-error') {
    const kind = url.searchParams.get('kind')
    if (kind !== 'rate_limit' && kind !== 'request') return new Response(null, { status: 400 })
    console.warn(JSON.stringify({ event: 'forecast_client_error', point, kind }))
    return new Response(null, { status: 204 })
  }
  if (route === 'forecast-snapshots') return routes.has('snapshots') ? forward(['before']) : captureSnapshot(env, point, en)
  return new Response(null, { status: 404 })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const routes = weatherRoutes(env)
    if (!routes) return new Response(null, { status: 500, headers: { 'cache-control': 'no-store' } })
    if (url.pathname === '/internal/tracked-points') return trackedPoints(request, env)
    if (url.pathname === stoweObservationPath) {
      if (request.method !== 'GET') return new Response(null, { status: 405 })
      return stoweObservations()
    }
    if (url.pathname.startsWith('/api/auth/')) return auth(env, url.origin).handler(request)
    if (url.pathname === '/api/me') return me(request, env, url)
    if (url.pathname.startsWith('/api/')) return api(request, env, ctx, url, routes)
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
