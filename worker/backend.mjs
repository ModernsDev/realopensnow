import { catalog } from './generated.js'
import { localDate } from '../src/weather.ts'

const groups = new Set(['catalog', 'snapshots', 'ondemand', 'regions'])
const noStore = { 'cache-control': 'no-store' }
const sixHours = 21600
const encoder = new TextEncoder()
const digest = value => crypto.subtle.digest('SHA-256', encoder.encode(value))

export function weatherRoutes(env) {
  const routes = env.WEATHER_ROUTES === '' ? [] : typeof env.WEATHER_ROUTES === 'string' && env.WEATHER_ROUTES.split(',').map(group => group.trim())
  if (!routes || routes.some(group => !groups.has(group))) console.error('Invalid WEATHER_ROUTES', env.WEATHER_ROUTES)
  else if (!['open', 'frozen'].includes(env.SNAPSHOT_WRITES)) console.error('Invalid SNAPSHOT_WRITES', env.SNAPSHOT_WRITES)
  else return new Set(routes)
}

export async function trackedPoints(request, env) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: noStore })
  if (!env.WORKER_SECRET) return new Response(null, { status: 503, headers: noStore })
  const [actual, expected] = await Promise.all([digest(request.headers.get('authorization') ?? ''), digest(`Bearer ${env.WORKER_SECRET}`)])
  if (!crypto.subtle.timingSafeEqual(actual, expected)) return new Response(null, { status: 401, headers: noStore })
  const { results } = await env.DB.prepare('SELECT DISTINCT resort_id FROM user_favorites').all()
  const points = new Set(results.flatMap(({ resort_id }) => Object.hasOwn(catalog.resorts, resort_id) ? catalog.resorts[resort_id] : []))
  return Response.json({ catalog: catalog.digest, points: [...points].sort() }, { headers: noStore })
}

function fresh(body) {
  try {
    const { fetched, dates, timezone } = JSON.parse(new TextDecoder().decode(body))
    const now = Date.now()
    return now - Date.parse(fetched) < sixHours * 1000 && typeof timezone === 'string' && dates?.[0] === localDate(now, timezone)
  } catch {
    return false
  }
}

export async function forwardWeather(request, env, ctx, url, params, forecastPoint) {
  const en = request.headers.get('accept-language') === 'en'
  const fail = (status, zh, english) => Response.json({ error: en ? english : zh }, { status, headers: noStore })
  const { success } = await env.WEATHER_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') })
  if (!success) return fail(429, '请求过于频繁，请稍后重试。', 'Too many requests. Please try again later.')

  const target = new URL(url.pathname, env.BACKEND_ORIGIN)
  for (const [key, value] of url.searchParams) if (params.includes(key)) target.searchParams.append(key, value)
  const headers = new Headers({ 'cf-access-client-id': env.ACCESS_CLIENT_ID, 'cf-access-client-secret': env.ACCESS_CLIENT_SECRET })
  if (request.headers.has('accept-language')) headers.set('accept-language', request.headers.get('accept-language'))
  const cacheKey = forecastPoint && new Request(`${url.origin}/__cache/forecast/${forecastPoint}?catalog=${catalog.digest}`)
  const unavailable = status => fail(status, '天气服务暂不可用，请稍后重试。', 'The weather service is unavailable. Please try again later.')
  const signal = AbortSignal.timeout(15000)
  let failureStatus = 502
  try {
    const response = await fetch(target, { method: request.method, headers, redirect: 'manual', signal })
    const { status } = response
    if ((status >= 300 && status < 400) || status === 401 || status === 403) {
      console.error(JSON.stringify({ event: 'backend_auth', status }))
      return unavailable(502)
    }
    if (!cacheKey || status < 500) {
      const body = response.body && await response.arrayBuffer()
      if (cacheKey && status === 200 && fresh(body)) {
        const copy = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${sixHours}` } })
        ctx.waitUntil(caches.default.put(cacheKey, copy))
      }
      const headers = new Headers(noStore)
      if (response.headers.has('content-type')) headers.set('content-type', response.headers.get('content-type'))
      return new Response(body, { status, headers })
    }
  } catch (error) {
    console.error('weather_backend', error.message)
    if (signal.aborted || error.name === 'TimeoutError') failureStatus = 504
  }
  if (cacheKey) {
    try {
      const cached = await caches.default.match(cacheKey)
      if (cached) {
        const body = await cached.arrayBuffer()
        if (fresh(body)) return new Response(body, { headers: { ...noStore, 'content-type': 'application/json' } })
      }
    } catch (error) {
      console.error('weather_cache_read', error.message)
    }
  }
  return unavailable(failureStatus)
}
