import assert from 'node:assert/strict'
import { test } from 'node:test'
import { models } from '../src/weather.ts'
import { waterburyPoint } from '../src/catalog.ts'
import { observationWindow, pairedSnow, summarizeAccuracy } from '../worker/accuracy.mjs'
import { captureSnapshot } from '../worker/forecast-snapshots.mjs'

const hour = 3_600_000
const date = (day: number, h = 6) => `2026-11-${day}T${String(h).padStart(2, '0')}:00:00+00:00`
const station = { stationNumber: 'VT-WS-19', latitude: 44.3606, longitude: -72.8077, units: 'english' }
const row = (obsDateTime: string, depthOfSnowfall = 2) => ({
  ...station, obsDateTime, depthOfSnowfall, depthOfSnowfallIsTrace: false,
  depthOfSnowOnGround: 99, waterContentOfSnowfall: 88,
})
const ending = row(date(17))
const previous = row(date(16))
const window = observationWindow(ending, previous)
const location = { ...waterburyPoint.coordinates.value!, pointId: waterburyPoint.id, elevation: waterburyPoint.elevation.value }

function snapshot(fetchedAt: number, snowfall: number | null) {
  return {
    fetchedAt, query: location,
    hourly: { quantity: 'new_snow_depth', unit: 'cm', firstEnd: window.start + hour, values: [
      Array(24).fill(snowfall), Array(24).fill(0), Array(24).fill(null),
    ] },
  }
}

test('only same-station direct, finite snow depth within an exact 24-hour window is comparable', () => {
  assert.equal(window.start, Date.parse('2026-11-16T11:00:00Z'))
  assert.equal(window.end, Date.parse('2026-11-17T11:00:00Z'))
  assert.equal(window.value, 2)
  assert.equal(window.unit, 'in')
  const excluded = [
    [{ ...ending, stationNumber: 'other' }, previous, 'station'],
    [ending, { ...previous, latitude: 44 }, 'station'],
    [ending, row(date(16, 7)), 'window'],
    [ending, row(date(15)), 'window'],
    [ending, null, 'window'],
    [row(date(2)), row(date(1, 1)), 'window'],
    [row(date(1)), row('2026-10-31T06:00:00+00:00'), 'window'],
    [{ ...ending, depthOfSnowfall: null }, previous, 'measurement'],
    [{ ...ending, depthOfSnowfall: 0, depthOfSnowfallIsTrace: true }, previous, 'measurement'],
    [{ ...ending, units: 'metric' }, previous, 'measurement'],
  ] as const
  for (const [latest, earlier, reason] of excluded) assert.deepEqual(observationWindow(latest, earlier), { excluded: reason })
})

test('matching requires correct altitude, coordinates, quantity, units and every accumulated hour', () => {
  const valid = snapshot(window.start - hour, 0.25)
  assert.equal(pairedSnow(valid, 0, window), 6 - 2 * 2.54)
  assert.equal(pairedSnow(valid, 1, window), -2 * 2.54)
  assert.equal(pairedSnow(valid, 2, window), null)
  for (const query of [{ ...location, lat: 44 }, { ...location, elevation: 140 }, { ...location, pointId: 'stowe-base' }]) {
    assert.equal(pairedSnow({ ...valid, query }, 0, window), null)
  }
  for (const quantity of ['snow_depth', 'snow_water_equivalent']) {
    assert.equal(pairedSnow(valid, 0, { ...window, quantity }), null)
  }
  assert.equal(pairedSnow(valid, 0, { ...window, unit: 'mm' }), null)
  assert.equal(pairedSnow(valid, 0, { ...window, start: window.start + 1 }), null)
  assert.equal(pairedSnow(valid, 0, { ...window, end: window.end + hour }), null)
})

test('scores count a window once per model and lead, use only forecasts acquired before the window, and retain unavailable metrics', () => {
  const now = window.end + hour
  const result = summarizeAccuracy([
    snapshot(window.start + hour, 99),
    snapshot(window.start, 99),
    snapshot(window.start - hour, 0.25),
    snapshot(window.start - 2 * hour, 1),
    snapshot(window.start - 25 * hour, 0.125),
  ], [ending, previous], now)
  assert.equal(result.groups.length, models.length * 7)
  const score = (model: string, lead: number) => result.groups.find(group => group.model === model && group.lead === lead)
  assert.deepEqual(score('ecmwf_ifs025', 0), { model: 'ecmwf_ifs025', lead: 0, count: 1, bias: 6 - 5.08, mae: 6 - 5.08, insufficient: true })
  assert.deepEqual(score('ecmwf_ifs025', 1), { model: 'ecmwf_ifs025', lead: 1, count: 1, bias: 3 - 5.08, mae: 5.08 - 3, insufficient: true })
  assert.deepEqual(score('icon_seamless', 0), { model: 'icon_seamless', lead: 0, count: 0, bias: null, mae: null, insufficient: true })
})

test('snapshot capture uses Worker-supported manual redirects and rejects upstream redirection', async () => {
  const realFetch = globalThis.fetch
  let redirectMode: RequestRedirect | undefined
  globalThis.fetch = async (_url, options) => {
    redirectMode = options?.redirect
    return Response.redirect('https://example.invalid/', 302)
  }
  try {
    const response = await captureSnapshot({}, waterburyPoint.id)
    assert.equal(redirectMode, 'manual')
    assert.equal(response.status, 502)
  } finally {
    globalThis.fetch = realFetch
  }
})
