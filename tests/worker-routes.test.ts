import assert from 'node:assert/strict'
import { timingSafeEqual } from 'node:crypto'
import { registerHooks } from 'node:module'
import { test, type TestContext } from 'node:test'

const generated = `export const assets = new Map(), points = new Set(['alta-base', 'alta-top', 'stowe-base'])
export const catalog = { digest: 'fixture-digest', resorts: { alta: ['alta-top', 'alta-base'], stowe: ['stowe-base'] } }`
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === './generated.js' && context.parentURL?.includes('/worker/')) return { url: 'data:text/javascript,' + encodeURIComponent(generated), shortCircuit: true }
  return next(specifier, context)
} })
const { default: worker } = await import('../worker/index.js')
hook.deregister()

const origin = 'https://snow.example'
const point = '/api/forecast/alta-base'
const history = '/api/forecast-snapshots/alta-base'
const accuracy = '/api/forecast-accuracy/alta-base'
const regions = '/api/regions/north-america'
const now = Date.parse('2026-11-28T05:30:00Z')
const forecast = { fetched: new Date(now).toISOString(), dates: ['2026-11-27'], timezone: 'America/Denver' }
const unavailable = 'The weather service is unavailable. Please try again later.'

function setup(t: TestContext, routes = '') {
  const db = { first: t.mock.fn(() => null), all: t.mock.fn(() => ({ results: [] })) }
  const env = {
    WEATHER_ROUTES: routes, SNAPSHOT_WRITES: 'open', BACKEND_ORIGIN: 'https://backend.example',
    ACCESS_CLIENT_ID: 'client', ACCESS_CLIENT_SECRET: 'secret', WORKER_SECRET: 'worker-secret',
    WEATHER_LIMIT: { limit: t.mock.fn(() => ({ success: true })) },
    DB: { prepare: t.mock.fn((_sql: string) => ({ ...db, bind: () => db })) },
  }
  const ctx = { waitUntil: t.mock.fn((_work: Promise<void>) => {}) }
  const cache = {
    put: t.mock.fn(async (_key: Request, _copy: Response) => {}),
    match: t.mock.fn(async (_key: Request): Promise<Response | undefined> => undefined),
  }
  Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })
  t.after(() => Reflect.deleteProperty(globalThis, 'caches'))
  t.mock.method(Date, 'now', () => now)
  const upstream = t.mock.method(globalThis, 'fetch', async () => Response.json({ result: true }))
  const error = t.mock.method(console, 'error', () => {})
  const request = (path: string, method = 'GET', headers: Record<string, string> = {}) => worker.fetch(new Request(origin + path, {
    method, headers: { 'cf-connecting-ip': '192.0.2.1', 'accept-language': 'en', origin, ...headers }, body: method === 'POST' ? 'private' : null,
  }), env, ctx)
  return { env, ctx, cache, upstream, error, db, request }
}

async function checkError(response: Response, status: number, error: string) {
  assert.equal(response.status, status)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { error })
}

test('default routes use the local forecast, history, accuracy and snapshot handlers', async t => {
  const { env, upstream, request } = setup(t)
  assert.equal((await request(point)).status, 404)
  assert.match(env.DB.prepare.mock.calls[0].arguments[0], /FROM forecast_latest/)
  assert.deepEqual(await (await request(history)).json(), { snapshots: [], next: null })
  assert.match(env.DB.prepare.mock.calls[1].arguments[0], /FROM forecast_snapshots/)
  await checkError(await request(accuracy), 404, 'This point has no co-located new snow observations.')
  for (const path of ['/api/forecast?lat=45', '/api/location?lat=45', regions]) assert.equal((await request(path)).status, 404)
  assert.equal(upstream.mock.callCount(), 0)
  upstream.mock.mockImplementation(async () => new Response(null, { status: 429 }))
  await checkError(await request(history, 'POST'), 429, 'Open-Meteo is rate limiting requests; no snapshot was saved.')
  assert.equal(upstream.mock.callCount(), 1)
  assert.equal(new URL(String(upstream.mock.calls[0].arguments[0])).hostname, 'api.open-meteo.com')
  assert.equal(env.WEATHER_LIMIT.limit.mock.callCount(), 0)
})

for (const [group, method, path, query, status] of [
  ['catalog', 'GET', point, '', 200],
  ['snapshots', 'GET', history, 'before=42', 200],
  ['snapshots', 'POST', history, 'before=42', 201],
  ['snapshots', 'GET', accuracy, '', 404],
  ['ondemand', 'GET', '/api/forecast', 'lat=45&lon=-72&elevation=314&timezone=America%2FDenver&resortId=alta&pointId=alta-base', 422],
  ['ondemand', 'GET', '/api/location', 'lat=45&lon=-72', 200],
  ['regions', 'GET', regions, '', 503],
] as const) test(`${group} forwards ${method} ${path} with the route's query and headers`, async t => {
  const { env, request, upstream } = setup(t, group)
  const raw = '{  "result": true }\n'
  const type = 'application/json; charset=utf-8'
  upstream.mock.mockImplementation(async () => new Response(raw, { status, headers: { 'content-type': type, 'set-cookie': 'private=1', 'cache-control': 'public' } }))
  const timeout = t.mock.method(AbortSignal, 'timeout')
  const extra = ['lat=3', 'lon=4', 'before=7', 'elevation=9', 'timezone=UTC', 'resortId=x', 'pointId=x'].filter(p => !query.includes(p.split('=')[0] + '='))
  const response = await request(path + '?' + [query, ...extra, 'debug=1'].filter(Boolean).join('&'), method, {
    cookie: 'private=1', authorization: 'Bearer private', 'cf-access-client-secret': 'forged', 'accept-language': 'en-US,en;q=0.9',
  })
  assert.equal(response.status, status)
  assert.equal(await response.text(), raw)
  assert.deepEqual(Object.fromEntries(response.headers), { 'cache-control': 'no-store', 'content-type': type })
  assert.deepEqual(env.WEATHER_LIMIT.limit.mock.calls[0].arguments, [{ key: '192.0.2.1' }])
  assert.equal(upstream.mock.callCount(), 1)
  const [url, init] = upstream.mock.calls[0].arguments
  assert.equal(String(url), env.BACKEND_ORIGIN + path + (query ? '?' + query : ''))
  assert.equal(init.method, method)
  assert.equal(init.redirect, 'manual')
  assert.equal(init.body, undefined)
  assert.deepEqual(timeout.mock.calls[0].arguments, [15000])
  assert.equal(init.signal, timeout.mock.calls[0].result)
  assert.deepEqual(Object.fromEntries(new Headers(init.headers)), { 'accept-language': 'en-US,en;q=0.9', 'cf-access-client-id': 'client', 'cf-access-client-secret': 'secret' })
})

test('invalid switches fail visibly before dispatch', async t => {
  const { env, error, upstream, request } = setup(t, 'snapshots,unknown')
  assert.equal((await request(history)).status, 500)
  env.WEATHER_ROUTES = ''
  env.SNAPSHOT_WRITES = 'closed'
  assert.equal((await request(point)).status, 500)
  assert.equal(error.mock.callCount(), 2)
  assert.equal(upstream.mock.callCount(), 0)
  assert.equal(env.DB.prepare.mock.callCount(), 0)
})

test('freeze, point validation and POST origin checks precede backend access', async t => {
  const { env, upstream, request } = setup(t)
  env.SNAPSHOT_WRITES = 'frozen'
  for (const routes of ['', 'catalog,snapshots']) {
    env.WEATHER_ROUTES = routes
    await checkError(await request(history, 'POST'), 503, 'Saving snapshots is paused. Please try again later.')
    await checkError(await request(history, 'POST', { origin: 'https://other.example', 'accept-language': 'en-US' }), 503, '快照保存暂时关闭，请稍后再试。')
  }
  env.SNAPSHOT_WRITES = 'open'
  assert.equal((await request(history, 'POST', { origin: 'https://other.example' })).status, 403)
  for (const path of [point, history, accuracy]) assert.equal((await request(path.replace('alta-base', 'unknown'))).status, 404)
  assert.equal(upstream.mock.callCount(), 0)
  assert.equal(env.WEATHER_LIMIT.limit.mock.callCount(), 0)
  assert.equal(env.DB.prepare.mock.callCount(), 0)
})

test('rate limits reject forwarding before fetch or cache lookup', async t => {
  const { env, request, upstream, cache } = setup(t, 'catalog,ondemand')
  env.WEATHER_LIMIT.limit.mock.mockImplementation(() => ({ success: false }))
  await checkError(await request(point), 429, 'Too many requests. Please try again later.')
  await checkError(await request('/api/location', 'GET', { 'accept-language': 'zh' }), 429, '请求过于频繁，请稍后重试。')
  assert.equal(upstream.mock.callCount(), 0)
  assert.equal(cache.match.mock.callCount(), 0)
})

test('access errors log the status and bypass cached forecasts', async t => {
  const { request, upstream, error, cache } = setup(t, 'catalog')
  for (const status of [301, 302, 307, 401, 403]) {
    upstream.mock.mockImplementation(async () => new Response(null, { status }))
    await checkError(await request(point), 502, unavailable)
    assert.deepEqual(error.mock.calls.at(-1)?.arguments, [JSON.stringify({ event: 'backend_auth', status })])
  }
  assert.equal(cache.match.mock.callCount(), 0)
})

test('timeout and network errors use localized errors or a fresh catalog forecast', async t => {
  const { request, upstream, error, cache } = setup(t, 'catalog')
  for (const [name, status] of [['TimeoutError', 504], ['TypeError', 502]] as const) {
    upstream.mock.mockImplementation(async () => { throw new DOMException('connection failed', name) })
    cache.match.mock.mockImplementation(async () => undefined)
    await checkError(await request(point), status, unavailable)
    await checkError(await request(point, 'GET', { 'accept-language': 'zh' }), status, '天气服务暂不可用，请稍后重试。')
    cache.match.mock.mockImplementation(async () => Response.json(forecast))
    assert.deepEqual(await (await request(point)).json(), forecast)
  }
  assert.equal(error.mock.callCount(), 6)
})

test('catalog caches only fresh forecasts and rechecks age and local date on fallback', async t => {
  const { ctx, request, upstream, cache } = setup(t, 'catalog')
  const key = origin + '/__cache/forecast/alta-base?catalog=fixture-digest'
  const raw = JSON.stringify(forecast, null, 2)
  upstream.mock.mockImplementation(async () => new Response(raw, { headers: { 'content-type': 'application/json' } }))
  const response = await request(point)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(await response.text(), raw)
  assert.equal(cache.put.mock.callCount(), 1)
  const [storedKey, copy] = cache.put.mock.calls[0].arguments
  assert.equal(storedKey.url, key)
  assert.equal(storedKey.method, 'GET')
  assert.deepEqual(Object.fromEntries(copy.headers), { 'cache-control': 'public, max-age=21600', 'content-type': 'application/json' })
  assert.equal(await copy.clone().text(), raw)
  assert.deepEqual(ctx.waitUntil.mock.calls[0].arguments, [cache.put.mock.calls[0].result])
  upstream.mock.mockImplementation(async () => new Response(null, { status: 503 }))
  cache.match.mock.mockImplementation(async () => copy)
  const fallback = await request(point)
  assert.equal(cache.match.mock.calls[0].arguments[0].url, key)
  assert.equal(fallback.status, 200)
  assert.equal(fallback.headers.get('cache-control'), 'no-store')
  assert.equal(await fallback.text(), raw)
  for (const stale of [{ ...forecast, fetched: new Date(now - 21600000).toISOString() }, { ...forecast, fetched: new Date(now - 21600001).toISOString() }, { ...forecast, dates: ['2026-11-26'] }]) {
    upstream.mock.mockImplementation(async () => Response.json(stale))
    assert.deepEqual(await (await request(point)).json(), stale)
    assert.equal(cache.put.mock.callCount(), 1)
    upstream.mock.mockImplementation(async () => new Response(null, { status: 500 }))
    cache.match.mock.mockImplementation(async () => Response.json(stale))
    await checkError(await request(point), 502, unavailable)
  }
  cache.match.mock.mockImplementation(async () => { throw new Error('cache unavailable') })
  await checkError(await request(point), 502, unavailable)
})

test('tracked points require the bearer secret and expand distinct catalog favorites', async t => {
  const { env, db, request } = setup(t)
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { value: timingSafeEqual, configurable: true })
  t.after(() => Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual'))
  const path = '/internal/tracked-points'
  for (const [method, authorization, secret, status] of [
    ['POST', 'Bearer worker-secret', 'worker-secret', 405], ['GET', 'Bearer worker-secret', '', 503],
    ['GET', '', 'worker-secret', 401], ['GET', 'Bearer worker-secrex', 'worker-secret', 401], ['GET', 'worker-secret', 'worker-secret', 401],
  ] as const) {
    env.WORKER_SECRET = secret
    const response = await request(path, method, { authorization })
    assert.equal(response.status, status)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  assert.equal(env.DB.prepare.mock.callCount(), 0)
  db.all.mock.mockImplementation(() => ({ results: ['stowe', 'custom-1', 'alta', 'stowe', 'constructor'].map(resort_id => ({ resort_id })) }))
  const response = await request(path, 'GET', { authorization: 'Bearer worker-secret' })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { catalog: 'fixture-digest', points: ['alta-base', 'alta-top', 'stowe-base'] })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(env.DB.prepare.mock.calls[0].arguments, ['SELECT DISTINCT resort_id FROM user_favorites'])
})
