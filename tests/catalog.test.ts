import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resorts, sources, chineseAliases, searchResorts, queryBlockReason } from '../src/catalog.ts'
import { forecast, reportBlockReason, type Forecast } from '../src/weather.ts'

const manual = resorts.slice(0, 6)

test('six stable directory identities retain existing favorites and traceable field metadata', () => {
  assert.deepEqual(manual.map(r => r.id), ['alta', 'snowbird', 'niseko', 'chamonix', 'killington', 'stowe'])
  for (const r of manual) {
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
  assert.equal(searchResorts('Bear Mountain', manual)[0].id, 'killington')
  assert.equal(searchResorts('Argentière')[0].id, 'chamonix')
  assert.equal(searchResorts('夏蒙尼')[0].name, 'Les Grands Montets')
  const utah = searchResorts('Utah').map(r => r.id)
  assert.ok(utah.includes('alta') && utah.includes('snowbird') && utah.length > 2)
  assert.equal(searchResorts('Pico Mountain', manual).length, 0)
  assert.deepEqual(searchResorts('Pico Mountain').map(r => r.id), ['us-vt-pico-mountain-resort'])
  assert.equal(searchResorts('Brévent').length, 0)
})

test('all 18 forecast points have distinct mapped coordinates and ordered, traceable terrain heights', () => {
  const coordinates = new Set<string>()
  for (const r of manual) {
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
      assert.equal(reportBlockReason(data, r), null)
      assert.ok(reportBlockReason({ ...data, query: { ...data.query, resortId: resorts[2].id } }, r))
      assert.ok(reportBlockReason({ ...data, query: { ...data.query, elevation: 9999 } }, r))
      assert.ok(reportBlockReason({ ...data, query: { ...data.query, lat: 0 } }, r))
      assert.ok(reportBlockReason({ ...data, query: { ...data.query, pointId: r.points[0].id } }, r))
      assert.ok(reportBlockReason({ ...data, query: undefined } as unknown as Forecast, r))
    }
    assert.equal(requests.length, 2)
    assert.equal(resorts[0].points[3].elevation.value, 2667)
    assert.equal(resorts[1].points[3].elevation.value, 2795)
  } finally { globalThis.fetch = original }
})

test('mapped North American records have unique IDs, usable points and traceable terrain', () => {
  const directory = resorts.slice(6)
  assert.ok(directory.length > 750)
  assert.deepEqual(directory.map(r => r.id), directory.map(r => r.id).sort())
  assert.equal(new Set(resorts.map(r => r.id)).size, resorts.length)
  const pointIds = resorts.flatMap(r => r.points.map(p => p.id))
  assert.equal(new Set(pointIds).size, pointIds.length)
  const covered = new Set(['us-ut-alta-ski-area', 'us-ut-snowbird', 'us-vt-killington', 'us-vt-killington-resort', 'us-vt-stowe-mountain-resort'])
  for (const r of directory) {
    assert.ok(!covered.has(r.id))
    assert.match(r.id, /^(us|ca|mx)-[a-z0-9]+(?:-[a-z0-9]+)+$/)
    assert.equal(r.id.slice(0, 2).toUpperCase(), r.country)
    assert.deepEqual(r.areas, [{ id: r.id, name: r.name }])
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: r.timezone }))
    assert.ok(r.points.length)
    const kinds = r.points.map(p => p.kind).join(',')
    assert.ok(['base', 'base,top', 'base,mid,top', 'site'].includes(kinds), r.id)
    for (const [index, p] of r.points.entries()) {
      assert.equal(p.id, r.id + '-' + p.kind)
      assert.equal(queryBlockReason(r, p), null)
      assert.equal(p.coordinates.status, 'mapped')
      assert.equal(p.elevation.status, 'mapped')
      assert.deepEqual(p.elevation.sources, [p.kind === 'site' ? 'openmeteoGeo' : 'openskimap'])
      assert.ok(Number.isInteger(p.elevation.value))
      const { lat, lon } = p.coordinates.value!
      assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
      if (index > 0) assert.ok(p.elevation.value! - r.points[index - 1].elevation.value! >= (r.points.length === 3 ? 60 : 1))
    }
  }
  assert.ok(queryBlockReason(directory[0], { ...directory[0].points[0] }))
  for (const id of ['us-tn-ober-mountain', 'us-wi-nordic-mountain', 'us-ca-alta-sierra-ski-resort']) assert.ok(directory.some(r => r.id === id))
})

test('search normalizes accents, requires every term, ranks name prefixes and preserves ties', () => {
  for (const [id, aliases] of Object.entries(chineseAliases)) {
    assert.ok(resorts.some(r => r.id === id), id)
    for (const alias of aliases) assert.ok(searchResorts(alias).some(r => r.id === id), alias)
  }
  assert.deepEqual(searchResorts('vail COLORADO').map(r => r.id), ['us-co-vail'])
  assert.deepEqual(searchResorts('vail québec'), [])
  assert.deepEqual(searchResorts('vallee bleue'), searchResorts('Vallée Bleue'))
  assert.equal(searchResorts('vallee bleue')[0].name, 'Vallée Bleue')
  const bears = searchResorts('Bear Mountain')
  assert.deepEqual(bears.slice(0, 2).map(r => r.id), ['ca-bc-bear-mountain-ski-hill', 'us-ca-bear-mountain'])
  assert.ok(bears.indexOf(manual[4]) >= 2)
  assert.deepEqual(searchResorts('Bear Mountain', [manual[4], bears[1], bears[0]]), [bears[1], bears[0], manual[4]])
})
