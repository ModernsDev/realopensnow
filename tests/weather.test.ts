import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateHourly, availableModels, forecastDates, forecastExpired, forecast, models, snow, spread, total, value, type Forecast } from '../src/weather.ts'
import { resorts } from '../src/catalog.ts'

function hours(start: string, count: number, timezone = 'America/Denver') {
  const time = Array.from({ length: count + 2 }, (_, i) => Date.parse(start) / 1000 + (i - 1) * 3600)
  const hourly: Record<string, (number | null)[]> = { time }
  const hourly_units: Record<string, string> = { time: 'unixtime' }
  for (const model of models) for (const [field, unit, value] of [['snowfall', 'cm', 2.54], ['temperature_2m', '°C', -5], ['wind_gusts_10m', 'km/h', 30]] as const) {
    hourly[`${field}_${model.id}`] = time.map(() => value)
    hourly_units[`${field}_${model.id}`] = unit
  }
  return { timezone, hourly, hourly_units, latitude: 40.5, longitude: -111.75, elevation: 2667 }
}

test('civil dates use resort timezone at UTC midnight and include today plus six days', () => {
  assert.equal(forecastDates('2026-11-17T01:00:00Z', 'America/Denver')[0], '2026-11-16')
  assert.equal(forecastDates('2026-11-17T23:00:00Z', 'Asia/Tokyo')[0], '2026-11-18')
  assert.equal(forecastDates('2026-12-30T23:00:00Z', 'Europe/Paris').at(-1), '2027-01-06')
})

test('local daily sums include exactly 23/25 DST hours and snowfall belongs to its preceding hour', () => {
  for (const [start, date, count] of [['2026-03-08T08:00:00Z', '2026-03-08', 23], ['2026-11-01T07:00:00Z', '2026-11-01', 25]] as const) {
    const raw = hours(start, count)
    raw.hourly.snowfall_ecmwf_ifs025.fill(1)
    const { daily } = aggregateHourly(raw, [date], raw.timezone)
    assert.equal(daily.snowfall_sum_ecmwf_ifs025[0], count)
    assert.equal(daily.temperature_2m_min_ecmwf_ifs025[0], -5)
    assert.equal(daily.wind_gusts_10m_max_ecmwf_ifs025[0], 30)
    raw.hourly.snowfall_ecmwf_ifs025[1] = 10
    assert.equal(aggregateHourly(raw, [date], raw.timezone).daily.snowfall_sum_ecmwf_ifs025[0], count + 9)
  }
  const japan = hours('2026-11-16T16:00:00Z', 24, 'Asia/Tokyo')
  assert.ok(Math.abs(aggregateHourly(japan, ['2026-11-17'], japan.timezone).daily.snowfall_sum_gfs_seamless[0]! - 24 * 2.54) < 1e-10)
})

test('null, invalid numbers, incorrect units, missing model and partial days stay missing; genuine zero remains zero', () => {
  const raw = hours('2026-11-17T08:00:00Z', 168)
  const dates = forecastDates('2026-11-17T17:00:00Z', raw.timezone)
  raw.hourly.snowfall_ecmwf_ifs025.fill(0)
  raw.hourly.snowfall_gfs_seamless[2] = null
  raw.hourly.snowfall_icon_seamless[5] = Number.NaN
  let result = aggregateHourly(raw, dates, raw.timezone)
  assert.equal(result.daily.snowfall_sum_ecmwf_ifs025[0], 0)
  assert.equal(result.daily.snowfall_sum_gfs_seamless[0], null)
  assert.equal(result.daily.snowfall_sum_icon_seamless[0], null)
  assert.equal(total({ dates, ...result } as Forecast, models[1].id), null)
  assert.equal(snow(null, 'in'), '—')
  raw.hourly_units.snowfall_ecmwf_ifs025 = 'inch'
  delete raw.hourly.snowfall_icon_seamless
  result = aggregateHourly(raw, dates, raw.timezone)
  assert.equal(result.daily.snowfall_sum_ecmwf_ifs025[1], null)
  assert.ok(result.daily.snowfall_sum_icon_seamless.every(v => v === null))
  const partial = hours('2026-11-17T10:00:00Z', 20)
  assert.equal(aggregateHourly(partial, dates, raw.timezone).daily.snowfall_sum_gfs_seamless[0], null)
  assert.throws(() => aggregateHourly(raw, dates, 'Asia/Tokyo'), /时区/)
  raw.hourly.time[2] = raw.hourly.time[1]
  assert.throws(() => aggregateHourly(raw, dates, raw.timezone), /时间轴/)
})

test('cm/in convert the same unrounded daily values and seven-day totals exactly once', () => {
  const raw = hours('2026-11-17T08:00:00Z', 168)
  const dates = forecastDates('2026-11-17T17:00:00Z', raw.timezone)
  const result = aggregateHourly(raw, dates, raw.timezone)
  const data = { dates, ...result } as Forecast
  assert.equal(snow(result.daily.snowfall_sum_gfs_seamless[0], 'cm'), '61.0')
  assert.equal(snow(result.daily.snowfall_sum_gfs_seamless[0], 'in'), '24.0')
  assert.equal(snow(total(data, models[1].id), 'in'), '168.0')
  assert.equal(snow(total(data, models[1].id), 'cm'), '426.7')
})

test('API request explicitly fixes units and epoch times; network/HTTP/schema failures never become forecast data', async () => {
  const original = globalThis.fetch
  const raw = hours('2026-11-17T08:00:00Z', 168)
  try {
    globalThis.fetch = async input => {
      const url = new URL(String(input))
      assert.equal(url.searchParams.get('timeformat'), 'unixtime')
      assert.equal(url.searchParams.get('temperature_unit'), 'celsius')
      assert.equal(url.searchParams.get('wind_speed_unit'), 'kmh')
      assert.equal(url.searchParams.get('precipitation_unit'), 'mm')
      assert.equal(url.searchParams.get('timezone'), 'America/Denver')
      assert.equal(url.searchParams.get('models'), models.map(m => m.id).join(','))
      return Response.json(raw)
    }
    const data = await forecast(resorts[0], resorts[0].points[3])
    assert.ok(data.source.startsWith('https://api.open-meteo.com/v1/forecast?'))
    assert.ok(Date.parse(data.fetched) >= Date.parse(data.requested))
    assert.deepEqual(data.grid, { lat: 40.5, lon: -111.75 })
    globalThis.fetch = async () => new Response('', { status: 429 })
    await assert.rejects(forecast(resorts[0], resorts[0].points[3]), /429/)
    globalThis.fetch = async () => { throw new TypeError('offline') }
    await assert.rejects(forecast(resorts[0], resorts[0].points[3]), /offline/)
    globalThis.fetch = async () => Response.json({ ...raw, elevation: 10 })
    await assert.rejects(forecast(resorts[0], resorts[0].points[3]), /高度/)
    globalThis.fetch = async () => Response.json({ ...raw, hourly: {} })
    await assert.rejects(forecast(resorts[0], resorts[0].points[3]), /时间轴/)
  } finally { globalThis.fetch = original }
})

test('forecast expires at six hours or when the resort advances to its next civil date', () => {
  const data = {
    fetched: '2026-11-17T12:00:00Z',
    dates: ['2026-11-17'],
    timezone: 'Asia/Tokyo',
  } as Forecast
  assert.equal(forecastExpired(data, Date.parse('2026-11-17T14:59:59Z')), false)
  assert.equal(forecastExpired(data, Date.parse('2026-11-17T15:00:00Z')), true)
  assert.equal(forecastExpired({ ...data, timezone: 'America/Denver' }, Date.parse('2026-11-17T18:00:00Z')), true)
})

test('weighted blend uses fixed weights, renormalizes over available models and needs at least two', () => {
  const daily = {
    snowfall_sum_ecmwf_ifs025: [10, null, null, 0],
    snowfall_sum_gfs_seamless: [20, 20, null, 0],
    snowfall_sum_icon_seamless: [40, 40, 40, 0],
  }
  const data = { dates: ['a', 'b', 'c', 'd'], daily } as unknown as Forecast
  assert.equal(models.reduce((sum, m) => sum + m.weight, 0), 100)
  assert.deepEqual(data.dates.map((_, i) => value(data, 'snowfall_sum', 'weighted', i)), [20, 30, null, 0])
  assert.deepEqual(spread(data, 'snowfall_sum', 0), { low: 10, high: 40 })
  assert.equal(spread(data, 'snowfall_sum', 2), null)
})

test('models without data at a location are hidden and do not block the report or shift the blend', async () => {
  const original = globalThis.fetch
  const raw = hours('2026-11-17T08:00:00Z', 168)
  const now = new Date().toISOString()
  const start = Date.parse(forecastDates(now, 'America/Denver')[0]) / 1000 - 86400
  raw.hourly.time = Array.from({ length: 240 }, (_, i) => start + i * 3600)
  for (const key of Object.keys(raw.hourly)) if (key !== 'time') raw.hourly[key] = raw.hourly.time.map(() => key.startsWith('temp') ? -5 : 1)
  delete raw.hourly.snowfall_icon_d2
  delete raw.hourly.temperature_2m_icon_d2
  delete raw.hourly.wind_gusts_10m_icon_d2
  raw.hourly.wind_gusts_10m_ecmwf_aifs025_single.fill(null)
  raw.hourly.snowfall_gfs_hrrr.fill(9).fill(null, 91)
  try {
    globalThis.fetch = async () => Response.json(raw)
    const data = await forecast(resorts[0], resorts[0].points[3])
    const ids = (field?: string) => availableModels(data, field).map(m => m.id)
    assert.equal(ids().includes('icon_d2'), false)
    assert.equal(ids().includes('ecmwf_aifs025_single'), true)
    assert.equal(ids('wind_gusts_10m_max').includes('ecmwf_aifs025_single'), false)
    assert.equal(total(data, 'gfs_hrrr'), null)
    assert.equal(value(data, 'snowfall_sum', 'gfs_hrrr', 0), 216)
    assert.equal(value(data, 'snowfall_sum', 'weighted', 0), 24)
    assert.equal('blocked' in data.report, false)
  } finally { globalThis.fetch = original }
})
