import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocation, customLocationsKey, customResort, parseCoordinates, readCustomLocations, resolveLocation, saveCustomLocations } from '../src/customLocations.ts'
import { queryBlockReason, resorts } from '../src/catalog.ts'
import { dailyReport, forecast, reportBlockReason } from '../src/weather.ts'

test('GPS decimal, hemisphere and DMS inputs preserve axes and reject malformed pairs', () => {
  for (const text of ['40.588, -111.638', '40.588 -111.638', '40.588，-111.638', 'N40.588° W111.638°', '40.588° N, 111.638° W', 'W111.638 N40.588', '111.638W 40.588N', '111.638 W, 40.588', '40.588, -111.638W']) {
    assert.deepEqual(parseCoordinates(text), { lat: 40.588, lon: -111.638 }, text)
  }
  for (const text of [`40°35'16"N 111°38'17"W`, 'W111°38′17″ N40°35′16″', '111° 38′ 17″ W，40° 35′ 16″ N']) {
    const c = parseCoordinates(text)!
    assert.ok(Math.abs(c.lat - (40 + 35 / 60 + 16 / 3600)) < 1e-10, text)
    assert.ok(Math.abs(c.lon + (111 + 38 / 60 + 17 / 3600)) < 1e-10, text)
  }
  assert.deepEqual(parseCoordinates('180 E, 90 S'), { lat: -90, lon: 180 })
  for (const text of ['', '40', '91, 20', '20,-181', '40 20 0', '40,,20', '30N 40S', '20E,30W', '-30N,40W', '20,-30E', 'N30N,40W', '40°, W111 extra', 'NaN, 1', `40°60'1"N 111W`, `40°59'60"N 111W`, `90°0'1"N 111W`]) {
    assert.equal(parseCoordinates(text), null, text)
  }
})

test('location lookup sends one unrounded forecast request and exposes upstream and cancellation failures', async t => {
  const c = { lat: 40.588000123, lon: -111.638000987 }
  const controller = new AbortController()
  const fetch = t.mock.method(globalThis, 'fetch', async (input: URL | string, init: RequestInit) => {
    const url = new URL(input)
    assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast')
    assert.deepEqual(Object.fromEntries(url.searchParams), { latitude: String(c.lat), longitude: String(c.lon), timezone: 'auto', forecast_days: '1', daily: 'snowfall_sum' })
    assert.ok(init.signal instanceof AbortSignal)
    return Response.json({ elevation: 2603.6, timezone: 'America/Denver' })
  })
  assert.deepEqual(await resolveLocation(c, controller.signal), { elevation: 2604, timezone: 'America/Denver' })
  assert.equal(fetch.mock.callCount(), 1)
  for (const [response, expected] of [
    [new Response('', { status: 429 }), /限流.*429/], [new Response('', { status: 503 }), /失败.*503/],
    [new Response('{'), /数据无效/], [Response.json(null), /无效/], [Response.json({ elevation: null, timezone: 'UTC' }), /无效/],
    [Response.json({ elevation: 12, timezone: 'Unknown/Mountain' }), /无效/],
  ] as const) {
    fetch.mock.mockImplementationOnce(async () => response)
    await assert.rejects(resolveLocation(c), expected)
  }
  controller.abort()
  fetch.mock.mockImplementationOnce(async (_input: URL | string, init: RequestInit) => {
    init.signal!.throwIfAborted()
    assert.fail('请求应跟随调用方取消')
  })
  await assert.rejects(resolveLocation(c, controller.signal), { name: 'AbortError' })
})

test('local GPS records survive reload and corrupt or inaccessible storage produces actionable errors', () => {
  const l = createLocation('  山口  ', { lat: 40.5879626, lon: -111.637994 }, 2603, 'America/Denver')
  assert.match(l.id, /^custom-[0-9a-f-]{36}$/)
  assert.match(l.createdOn, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(l.name, '山口')
  assert.deepEqual([l.lat, l.lon], [40.58796, -111.63799])
  const values = new Map<string, string>()
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  assert.deepEqual(readCustomLocations(storage), { locations: [], error: null })
  assert.equal(saveCustomLocations([l], storage), null)
  assert.deepEqual(readCustomLocations(storage), { locations: [l], error: null })
  for (const change of [{ id: 'alta' }, { id: 'custom-' }, { lat: 91 }, { lon: -181 }, { lat: '5' }, { elevation: null }, { elevation: 9001 }, { elevation: -501 }, { timezone: 'Mars/Olympus' }, { name: ' ' }, { createdOn: '2026-02-30' }]) {
    values.set(customLocationsKey, JSON.stringify([{ ...l, ...change }, l, l, null]))
    const result = readCustomLocations(storage)
    assert.deepEqual(result.locations, [l])
    assert.ok(result.error)
  }
  for (const raw of ['{', 'null', '{}']) {
    values.set(customLocationsKey, raw)
    const result = readCustomLocations(storage)
    assert.deepEqual(result.locations, [])
    assert.ok(result.error)
    assert.equal(values.get(customLocationsKey), raw)
  }
  const denied = () => { throw new DOMException('denied', 'SecurityError') }
  assert.ok(readCustomLocations(denied).error)
  assert.match(saveCustomLocations([l], denied)!, /仅在本页有效/)
})

test('custom forecasts and reports use their supplied resort and retain coordinate evidence', async t => {
  const l = createLocation('雪线', { lat: 46.125, lon: -110.25 }, 1432, 'America/Denver')
  const r = customResort(l)
  const [p] = r.points
  assert.equal(r.custom, true)
  assert.equal(r.country, '')
  assert.equal(r.updatedOn, l.createdOn)
  assert.equal(p.id, l.id + '-point')
  assert.equal(p.kind, 'custom')
  assert.equal(queryBlockReason(r, p), null)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ timezone: l.timezone, elevation: l.elevation, latitude: l.lat, longitude: l.lon, hourly: { time: [1794931200] }, hourly_units: { time: 'unixtime' } }))
  const f = await forecast(r, p)
  assert.equal(reportBlockReason(f, r), null)
  assert.match(f.report.blocked!, /七日预报数据不完整/)
  assert.ok(reportBlockReason(f, resorts[0]))
  assert.ok(dailyReport({ ...f, query: { ...f.query, resortId: 'alta' } }, r).blocked)
})
