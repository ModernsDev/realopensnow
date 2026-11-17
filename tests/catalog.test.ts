import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resorts, sources, searchResorts, queryBlockReason } from '../src/catalog.ts'
import { forecast, reportBlockReason, type Forecast } from '../src/weather.ts'

test('six stable directory identities retain existing favorites and traceable field metadata', () => {
  assert.deepEqual(resorts.map(r => r.id), ['alta', 'snowbird', 'niseko', 'chamonix', 'killington', 'stowe'])
  for (const r of resorts) {
    assert.equal(r.updatedOn, '2026-11-17')
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: r.timezone }))
    for (const ref of [...r.identitySources, ...r.timezoneSources, ...r.coordinates.sources]) assert.ok(sources[ref])
    assert.equal(r.coordinates.status, 'pending')
    assert.equal(r.coordinates.value, null)
    assert.deepEqual(r.points.slice(0, 3).map(p => p.kind), ['base', 'mid', 'top'])
    for (const p of r.points) {
      for (const field of [p.coordinates, p.elevation]) {
        assert.ok(field.sources.length)
        for (const ref of field.sources) {
          assert.ok(URL.canParse(sources[ref].url))
          assert.ok(sources[ref].checkedOn)
          assert.ok(sources[ref].license)
        }
        if (field.status === 'pending') assert.equal(field.value, null)
      }
      if (p.areaId) assert.ok(r.areas.some(a => a.id === p.areaId))
    }
  }
})

test('search distinguishes resort, country, aliases and named mountain areas', () => {
  for (const term of ['Hanazono', 'Grand HIRAFU', 'Niseko Village', 'Annupuri', '二世古', ' ＨＡＮＡＺＯＮＯ ']) assert.deepEqual(searchResorts(term).map(r => r.id), ['niseko'])
  assert.equal(searchResorts('Spruce Peak')[0].id, 'stowe')
  assert.equal(searchResorts('Bear Mountain')[0].id, 'killington')
  assert.equal(searchResorts('Argentière')[0].id, 'chamonix')
  assert.equal(searchResorts('夏蒙尼')[0].name, 'Les Grands Montets')
  assert.deepEqual(searchResorts('Utah').map(r => r.id), ['alta', 'snowbird'])
  assert.equal(searchResorts('Pico Mountain').length, 0)
  assert.equal(searchResorts('Brévent').length, 0)
})

test('all 18 forecast points have distinct mapped coordinates and ordered, traceable terrain heights', () => {
  const coordinates = new Set<string>()
  for (const r of resorts) {
    let previousElevation = 0
    for (const p of r.points.slice(0, 3)) {
      assert.equal(queryBlockReason(r, p), null)
      assert.ok(r.areas.some(area => area.id === p.areaId))
      const coord = JSON.stringify(p.coordinates.value)
      assert.ok(!coordinates.has(coord), p.id)
      coordinates.add(coord)
      assert.ok(Number.isInteger(p.elevation.value) && p.elevation.value! > previousElevation, p.id)
      previousElevation = p.elevation.value!
      assert.ok(p.coordinates.sources.some(ref => sources[ref].url.startsWith('https://www.openstreetmap.org/node/')))
      const dem = new URL(sources[p.elevation.sources[0]].url)
      if (r.id === 'niseko') {
        assert.match(dem.pathname, /N42_00_E140_00_DEM/)
        assert.ok(Math.floor(p.coordinates.value!.lat) === 42 && Math.floor(p.coordinates.value!.lon) === 140)
        assert.equal(p.elevation.value, [307, 759, 1177][r.points.indexOf(p)])
        continue
      }
      assert.equal(Number(dem.searchParams.get('lat') ?? dem.searchParams.get('y')), p.coordinates.value!.lat)
      assert.equal(Number(dem.searchParams.get('lon') ?? dem.searchParams.get('x')), p.coordinates.value!.lon)
    }
  }
  assert.equal(coordinates.size, 18)
})

test('missing or unverified point coordinates or elevation fail before requesting a forecast', async () => {
  const r = resorts[0]
  const p = r.points[0]
  const { coordinates, elevation } = p
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests++; throw new Error('must not request') }
  try {
    p.coordinates = { ...coordinates, status: 'pending', value: null }
    await assert.rejects(forecast(r, p), /坐标待核实/)
    p.coordinates = coordinates
    p.elevation = { ...elevation, value: null }
    await assert.rejects(forecast(r, p), /海拔待核实/)
    p.elevation = { ...elevation, status: 'pending' }
    await assert.rejects(forecast(r, p), /海拔待核实/)
    assert.equal(requests, 0)
  } finally {
    p.coordinates = coordinates
    p.elevation = elevation
    globalThis.fetch = originalFetch
  }
})

test('NRCS reference forecasts use each station coordinate, converted height and civil timezone; stale provenance blocks reports', async () => {
  const original = globalThis.fetch
  const requests: URL[] = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); requests.push(url)
    return Response.json({ latitude: 40.5, longitude: -111.75, hourly: { time: [1794931200] }, hourly_units: { time: 'unixtime' }, elevation: Number(url.searchParams.get('elevation')), timezone: url.searchParams.get('timezone') })
  }
  try {
    for (const r of resorts.slice(0, 2)) {
      const p = r.points[3]
      const data = await forecast(r, p)
      const url = requests.at(-1)!
      assert.equal(url.searchParams.get('latitude'), String(p.coordinates.value!.lat))
      assert.equal(url.searchParams.get('longitude'), String(p.coordinates.value!.lon))
      assert.equal(url.searchParams.get('elevation'), String(p.elevation.value))
      assert.equal(url.searchParams.get('timezone'), 'America/Denver')
      assert.equal(reportBlockReason(data), null)
      assert.ok(reportBlockReason({ ...data, query: { ...data.query, elevation: 9999 } }))
      assert.ok(reportBlockReason({ ...data, query: { ...data.query, lat: 0 } }))
      assert.ok(reportBlockReason({ ...data, query: { ...data.query, pointId: r.points[0].id } }))
      assert.ok(reportBlockReason({ ...data, query: undefined } as unknown as Forecast))
    }
    assert.equal(requests.length, 2)
    assert.equal(resorts[0].points[3].elevation.value, 2667)
    assert.equal(resorts[1].points[3].elevation.value, 2795)
  } finally { globalThis.fetch = original }
})
