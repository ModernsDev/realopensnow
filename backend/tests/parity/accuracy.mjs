import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { mock } from 'node:test'
import { resorts, waterburyPoint } from '../../../src/catalog.ts'
import { observationWindow, pairedSnow, summarizeAccuracy } from '../../../worker/accuracy.mjs'
import { captureSnapshot, stationAccuracy } from '../../../worker/forecast-snapshots.mjs'
import { forecastWindow } from '../../../worker/forecast-store.mjs'
import { stoweDailyReports } from '../../../worker/stowe-observations.mjs'

const read = file => JSON.parse(readFileSync(new URL('../fixtures/recorded/' + file, import.meta.url)))
const hour = 3_600_000
const day = hour * 24
const location = { ...waterburyPoint.coordinates.value, pointId: waterburyPoint.id, elevation: waterburyPoint.elevation.value }
const row = (date, value = 2) => ({
  stationNumber: 'VT-WS-19', latitude: location.lat, longitude: location.lon, units: 'english',
  obsDateTime: date, depthOfSnowfall: value, depthOfSnowfallIsTrace: false, depthOfSnowOnGround: 99, waterContentOfSnowfall: 88,
})
const date = (d, h = 6) => '2026-11-' + String(d).padStart(2, '0') + 'T' + String(h).padStart(2, '0') + ':00:00+00:00'
const scoreInput = s => ({ fetchedAt: s.fetched_at, query: s.query, hourly: s.hourly_snow })

async function rank(snapshots, reports, now) {
  const db = new DatabaseSync(':memory:')
  let ids, reportsUrl
  try {
    db.exec('CREATE TABLE forecast_snapshots (id INTEGER PRIMARY KEY, point TEXT, fetched_at INTEGER, payload TEXT, hourly_snow TEXT)')
    for (const s of snapshots) {
      db.prepare('INSERT INTO forecast_snapshots VALUES (?, ?, ?, ?, ?)').run(s.id, s.point, s.fetched_at,
        JSON.stringify({ id: s.id, query: s.query }), s.hourly_snow === null ? null : JSON.stringify(s.hourly_snow))
    }
    const DB = { prepare: sql => ({ bind: (...args) => ({ all: () => {
      const results = db.prepare(sql).all(...args.map(arg => Number.isSafeInteger(arg) ? BigInt(arg) : arg))
      ids = results.map(s => JSON.parse(s.payload).id)
      return { results }
    } }) }) }
    globalThis.fetch = async (url, options) => {
      assert.equal(options.headers.Accept, 'application/json')
      reportsUrl = String(url)
      return Response.json({ results: reports })
    }
    mock.timers.setTime(now)
    const result = await stationAccuracy({ DB }, location.pointId)
    assert.equal(result.status, 200)
    return { ids, summary: await result.json(), reportsUrl }
  } finally {
    db.close()
  }
}

function historical() {
  const ending = row(date(17)), previous = row(date(16))
  const reports = [ending, previous]
  const window = observationWindow(ending, previous)
  const now = window.end + hour
  const snapshot = (id, fetched_at, snow) => ({
    point: location.pointId, id, fetched_at, query: location,
    hourly_snow: { quantity: 'new_snow_depth', unit: 'cm', firstEnd: window.start + hour,
      values: [Array(24).fill(snow), Array(24).fill(0), Array(24).fill(null)] },
  })
  const snapshots = [[1, 99], [0, 99], [-1, 0.25], [-2, 1], [-25, 0.125]]
    .map(([offset, snow], i) => snapshot(i + 1, window.start + offset * hour, snow))
  const windows = [
    [ending, previous], [{ ...ending, stationNumber: 'other' }, previous], [ending, { ...previous, latitude: 44 }],
    [ending, row(date(16, 7))], [ending, row(date(15))], [ending, null], [row(date(2)), row(date(1, 1))],
    [row(date(1)), row('2026-10-31T06:00:00+00:00')], [row('2026-03-09T02:00:00+00:00'), row('2026-03-08T02:00:00+00:00')],
    [{ ...ending, depthOfSnowfall: null }, previous], [{ ...ending, depthOfSnowfall: 0, depthOfSnowfallIsTrace: true }, previous],
    [{ ...ending, units: 'metric' }, previous], [{ ...ending, depthOfSnowfall: -1 }, previous],
    [row(date(17).replace('+00:00', '.000+00:00')), previous], [row(date(17).replace('+00:00', 'Z')), previous],
  ].map(([r,p]) => ({ row: r, previous: p, window: observationWindow(r,p) }))
  const pairs = [
    [0, {}, {}], [1, {}, {}], [2, {}, {}], [0, {lat: 44}, {}], [0, {elevation: 140}, {}],
    [0, {pointId: 'stowe-base'}, {}], [0, {}, {quantity: 'snow_depth'}], [0, {}, {quantity: 'snow_water_equivalent'}],
    [0, {}, {unit: 'mm'}], [0, {}, {unit: 'cm'}], [0, {}, {start: window.start + 1}], [0, {}, {end: window.end + hour}],
  ].map(([model, query, w]) => {
    const s = { ...snapshots[2], query: {...location, ...query} }
    const input = { ...window, ...w }
    return { model, query: s.query, window: input, error: pairedSnow(scoreInput(s), model, input) }
  })
  const summary = summarizeAccuracy(snapshots.map(scoreInput), reports, now)
  const ranked = [...snapshots, {...snapshots[2], id: 6, fetched_at: snapshots[0].fetched_at},
    snapshot(7, now - 38 * day, 1), snapshot(8, now - 38 * day - 1, 1),
    {...snapshots[4], id: 9, hourly_snow: null}, {...snapshots[4], id: 10, point: 'other'}]
  const consecutive = Array.from({length: 11}, (_, i) => row(date(17-i), i / 10))
  const daily = consecutive.slice(0, -1).map((r, i) => {
    const {start} = observationWindow(r, consecutive[i+1])
    const s = snapshot(11+i, start-hour, i / 100)
    s.hourly_snow.firstEnd = start+hour
    return s
  })
  return { snapshots, reports, summary, now, windows, pairs, ranked,
    threshold: {snapshots: daily, reports: consecutive, summary: summarizeAccuracy(daily.map(scoreInput), consecutive, now)} }
}

async function manual(point, file, now, status = 200) {
  const resort = resorts.find(r => r.points.some(p => p.id === point))
  const p = resort.points.find(p => p.id === point)
  const raw = read(file)
  const {start, end} = forecastWindow(now, resort.timezone, 1, 8)
  const from = raw.hourly.time.indexOf(start), until = raw.hourly.time.indexOf(end) + 1
  assert.ok(from >= 0 && until > from)
  const data = { ...raw, elevation: p.elevation.value,
    hourly: Object.fromEntries(Object.entries(raw.hourly).map(([key, col]) => [key, col.slice(from, until)])) }
  let source, redirect, content = null
  mock.timers.setTime(now)
  globalThis.fetch = async (url, options) => {
    source = String(url)
    redirect = options.redirect
    mock.timers.setTime(now + 173)
    return status === 302 ? Response.redirect('https://example.invalid/') : Response.json(data, { status })
  }
  const DB = { prepare: () => ({ bind: (id, fetched_at_ms, payload, hourly) => ({ first: () => {
    assert.equal(id, point)
    content = { fetched_at_ms, payload: JSON.parse(payload), hourly_snow: hourly && JSON.parse(hourly) }
    return { id: 1 }
  } }) }) }
  const response = await captureSnapshot({ DB }, point)
  assert.equal(response.status, status === 302 ? 502 : 201)
  return { point, file, now, from, until, status, source, redirect, content }
}

export async function generateAccuracy() {
  const fetch = globalThis.fetch
  const { recordedAt } = read('index.json')
  mock.timers.enable({ apis: ['Date'], now: recordedAt })
  try {
    const recorded = await rank(read('waterbury-snapshots.json'), read('cocorahs.json').results, recordedAt)
    const synthetic = historical()
    synthetic.selection = await rank(synthetic.ranked, synthetic.reports, synthetic.now)
    const manualSnapshots = [
      await manual(waterburyPoint.id, 'page-stowe-waterbury-vt-ws-19.json', recordedAt),
      await manual('ca-nl-marble-mountain-base', 'page-custom-nl.json', recordedAt),
      await manual(waterburyPoint.id, 'page-stowe-waterbury-vt-ws-19.json', recordedAt, 302),
    ]
    const failures = []
    for (const [status, body] of [[503, {}], [200, {}], [200, {results: null}]]) {
      globalThis.fetch = async () => Response.json(body, {status})
      await assert.rejects(() => stoweDailyReports(35), error => {
        failures.push({ status, body, error: error.message })
        return true
      })
    }
    writeFileSync(new URL('../fixtures/expected/accuracy.json', import.meta.url),
      JSON.stringify({recorded, synthetic, manualSnapshots, failures}) + '\n')
  } finally {
    globalThis.fetch = fetch
    mock.timers.reset()
  }
}
