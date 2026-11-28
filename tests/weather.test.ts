import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateHourly, aggregatePeriods, upcomingNights, availableModels, pastDates, rangeSeries, forecastDates, forecastExpired, forecast, models, slicePeriod, snow, spread, total, value, type Forecast } from '../src/weather.ts'
import { resorts } from '../src/catalog.ts'

function hours(start: string, count: number, timezone = 'America/Denver') {
  const time = Array.from({ length: count + 2 }, (_, i) => Date.parse(start) / 1000 + (i - 1) * 3600)
  const hourly: Record<string, (number | null)[]> = { time }
  const hourly_units: Record<string, string> = { time: 'unixtime' }
  for (const model of models) for (const [field, unit, value] of [['snowfall', 'cm', 2.54], ['temperature_2m', '°C', -5], ['wind_gusts_10m', 'km/h', 30], ['rain', 'mm', 1], ['freezing_level_height', 'm', 1800]] as const) {
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

test('past dates are the seven complete resort days before today, across year and DST boundaries', () => {
  assert.deepEqual(pastDates('2027-01-03T01:00:00Z', 'America/Denver'), ['2026-12-26', '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'])
  const raw = hours('2026-10-31T06:00:00Z', 169)
  raw.hourly.snowfall_gfs_seamless.fill(1)
  const dates = pastDates('2026-11-07T17:00:00Z', raw.timezone)
  assert.equal(total({ dates, ...aggregateHourly(raw, dates, raw.timezone) }, 'gfs_seamless'), 169)
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

test('Denver day and night use the preceding hour for totals and gusts, and the timestamp for temperatures and freezing levels', () => {
  const raw = hours('2026-11-28T01:00:00Z', 37)
  const h = raw.hourly
  h.snowfall_ecmwf_ifs025.fill(1)
  h.snowfall_gfs_seamless.fill(0)
  h.snowfall_gfs_seamless[13] = 2
  h.snowfall_gfs_seamless[14] = 3
  h.snowfall_gfs_seamless[25] = 5
  h.temperature_2m_gfs_seamless[13] = 8
  h.temperature_2m_gfs_seamless[25] = 9
  h.temperature_2m_gfs_seamless[26] = -10
  h.freezing_level_height_gfs_seamless[13] = 500
  h.freezing_level_height_gfs_seamless[25] = 3000
  h.rain_gfs_seamless[25] = 4
  h.wind_gusts_10m_gfs_seamless[13] = 70
  const { dates, daily } = aggregatePeriods(raw, ['2026-11-27', '2026-11-28'], raw.timezone)
  assert.deepEqual(dates, ['2026-11-27-day', '2026-11-27-night', '2026-11-28-day', '2026-11-28-night'])
  assert.deepEqual(daily.snowfall_sum_ecmwf_ifs025, [null, 12, 12, 12])
  assert.deepEqual(daily.snowfall_sum_gfs_seamless, [null, 2, 8, 0])
  assert.deepEqual(daily.wet_snowfall_sum_gfs_seamless, [null, 2, 5, 0])
  assert.deepEqual(daily.rain_sum_gfs_seamless, [null, 12, 15, 12])
  assert.deepEqual(daily.wind_gusts_10m_max_gfs_seamless, [null, 70, 30, 30])
  assert.deepEqual(daily.temperature_2m_min_gfs_seamless, [null, -5, -5, -10])
  assert.deepEqual(daily.temperature_2m_max_gfs_seamless, [null, -5, 8, 9])
  assert.deepEqual(daily.freezing_level_height_min_gfs_seamless, [null, 1800, 500, 1800])
  assert.deepEqual(daily.freezing_level_height_max_gfs_seamless, [null, 1800, 1800, 3000])
})

test('Denver DST nights run from local 18:00 to 06:00 and sum every elapsed hour', () => {
  for (const [date, start, end, count] of [
    ['2026-03-07', '2026-03-08T01:00:00Z', '2026-03-08T12:00:00Z', 11],
    ['2026-10-31', '2026-11-01T00:00:00Z', '2026-11-01T13:00:00Z', 13],
  ] as const) {
    const raw = hours(start, count)
    raw.hourly.snowfall_gfs_seamless.fill(1)
    const series = aggregatePeriods(raw, [date], raw.timezone)
    assert.deepEqual(series.periods[1], { date, part: 'night', start: Date.parse(start), end: Date.parse(end), hours: count })
    assert.equal(series.daily.snowfall_sum_gfs_seamless[1], count)
  }
})

test('incomplete period coverage and missing or invalid hours stay null independently of genuine zero', () => {
  const raw = hours('2026-11-28T14:00:00Z', 11)
  raw.hourly.snowfall_gfs_seamless.fill(0)
  raw.hourly.snowfall_ecmwf_ifs025[3] = null
  raw.hourly.rain_gfs_seamless[4] = -1
  const { daily } = aggregatePeriods(raw, ['2026-11-28'], raw.timezone)
  assert.deepEqual(daily.snowfall_sum_gfs_seamless, [0, null])
  assert.deepEqual(daily.snowfall_sum_ecmwf_ifs025, [null, null])
  assert.deepEqual(daily.rain_sum_gfs_seamless, [null, null])
  raw.hourly.time = raw.hourly.time.map(t => t! - 3600)
  const earlier = aggregatePeriods(raw, ['2026-11-28'], raw.timezone)
  assert.equal(earlier.daily.snowfall_sum_gfs_seamless[0], null)
  assert.equal(earlier.daily.temperature_2m_min_gfs_seamless[0], -5)
})

test('periods reject mismatched zones, time units, off-hour timestamps and gaps', () => {
  const raw = hours('2026-11-28T13:00:00Z', 24)
  const aggregate = () => aggregatePeriods(raw, ['2026-11-28'], 'America/Denver')
  raw.timezone = 'UTC'
  assert.throws(aggregate, /时区/)
  raw.timezone = 'America/Denver'
  raw.hourly_units.time = 'iso8601'
  assert.throws(aggregate, /时间轴/)
  raw.hourly_units.time = 'unixtime'
  raw.hourly.time = [3601]
  assert.throws(aggregate, /时间轴/)
  raw.hourly.time = [3600, 10800]
  assert.throws(aggregate, /时间轴/)
})

test('upcoming nights include an ongoing night until 06:00 and honor the requested count', () => {
  const raw = hours('2026-11-28T01:00:00Z', 37)
  const series = aggregatePeriods(raw, ['2026-11-27', '2026-11-28', '2026-11-29'], raw.timezone)
  assert.deepEqual(upcomingNights(series, Date.parse('2026-11-28T03:00:00-07:00'), 2), [1, 3])
  assert.deepEqual(upcomingNights(series, Date.parse('2026-11-28T06:00:00-07:00'), 3), [3, 5])
  assert.deepEqual(upcomingNights(series, Date.parse('2026-11-28T12:00:00-07:00'), 1), [3])
  assert.deepEqual(upcomingNights(series, Date.parse('2026-11-28T12:00:00-07:00'), 0), [])
})

test('rain and wet snow include the closing midnight on a 23-hour day, while freezing levels include the opening midnight', () => {
  const raw = hours('2026-03-08T08:00:00Z', 23)
  const h = raw.hourly
  h.rain_gfs_seamless[0] = 100
  h.rain_gfs_seamless[23] = 3
  h.snowfall_gfs_seamless.fill(2)
  h.temperature_2m_gfs_seamless.fill(-1)
  h.temperature_2m_gfs_seamless[0] = null
  h.temperature_2m_gfs_seamless[4] = -0.9
  h.temperature_2m_gfs_seamless[23] = 0
  h.snowfall_gfs_seamless[23] = 5
  h.freezing_level_height_gfs_seamless[0] = -50
  h.freezing_level_height_gfs_seamless[23] = 3000
  const { daily } = aggregateHourly(raw, ['2026-03-08'], raw.timezone)
  assert.deepEqual(daily.rain_sum_gfs_seamless, [25])
  assert.deepEqual(daily.wet_snowfall_sum_gfs_seamless, [7])
  assert.deepEqual(daily.freezing_level_height_min_gfs_seamless, [-50])
  assert.deepEqual(daily.freezing_level_height_max_gfs_seamless, [1800])
})

test('invalid rain, freezing heights and either wet snow input stay missing independently of model status', () => {
  const raw = hours('2026-11-17T08:00:00Z', 24)
  raw.hourly_units.freezing_level_height_ecmwf_ifs025 = 'undefined'
  raw.hourly.freezing_level_height_ecmwf_ifs025.fill(null)
  raw.hourly_units.freezing_level_height_icon_seamless = 'undefined'
  raw.hourly.rain_ecmwf_ifs025[1] = -1
  raw.hourly.temperature_2m_ecmwf_ifs025[24] = null
  raw.hourly.snowfall_gfs_seamless[2] = -1
  raw.hourly_units.temperature_2m_icon_seamless = '°F'
  raw.hourly_units.snowfall_gem_global = 'mm'
  raw.hourly_units.rain_gfs_seamless = 'cm'
  delete raw.hourly.temperature_2m_icon_d2
  const { daily, modelStatus } = aggregateHourly(raw, ['2026-11-17'], raw.timezone)
  for (const id of ['ecmwf_ifs025', 'icon_seamless']) {
    assert.deepEqual(daily[`freezing_level_height_min_${id}`], [null])
    assert.deepEqual(daily[`freezing_level_height_max_${id}`], [null])
  }
  for (const id of ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_global', 'icon_d2']) {
    assert.deepEqual(daily[`wet_snowfall_sum_${id}`], [null])
  }
  assert.deepEqual(daily.rain_sum_ecmwf_ifs025, [null])
  assert.deepEqual(daily.rain_sum_gfs_seamless, [null])
  assert.equal(modelStatus.ecmwf_ifs025, '数据完整')
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
      assert.equal(url.searchParams.get('hourly'), 'snowfall,temperature_2m,wind_gusts_10m,rain,freezing_level_height')
      assert.equal(url.searchParams.get('temperature_unit'), 'celsius')
      assert.equal(url.searchParams.get('wind_speed_unit'), 'kmh')
      assert.equal(url.searchParams.get('precipitation_unit'), 'mm')
      assert.equal(url.searchParams.get('timezone'), 'America/Denver')
      assert.equal(url.searchParams.get('models'), models.map(m => m.id).join(','))
      return Response.json(raw)
    }
    const data = await forecast(resorts[0], resorts[0].points[3])
    assert.equal(new URL(data.source).searchParams.get('past_days'), '8')
    assert.equal(data.past.dates.length, 7)
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
    assert.deepEqual(data.periods.dates, [...data.past.dates, ...data.extended.dates].flatMap(date => [`${date}-day`, `${date}-night`]))
    const lastNight = data.periods.dates.indexOf(`${data.past.dates.at(-1)}-night`)
    assert.equal(data.periods.daily.snowfall_sum_gfs_seamless[lastNight], data.periods.periods[lastNight].hours)
    assert.equal(ids().includes('icon_d2'), false)
    assert.equal(ids().includes('ecmwf_aifs025_single'), true)
    assert.equal(ids('wind_gusts_10m_max').includes('ecmwf_aifs025_single'), false)
    assert.equal(total(data, 'gfs_hrrr'), null)
    assert.equal(value(data, 'snowfall_sum', 'gfs_hrrr', 0), 216)
    const weight = (id: string) => models.find(m => m.id === id)!.weight
    const sum = models.reduce((n, m) => n + m.weight, 0) - weight('icon_d2')
    assert.equal(value(data, 'snowfall_sum', 'weighted', 0), ((sum - weight('gfs_hrrr')) * 24 + weight('gfs_hrrr') * 216) / sum)
    assert.equal('blocked' in data.report, false)
  } finally { globalThis.fetch = original }
})

test('periods beyond a model horizon stay missing while nearer periods keep complete totals', () => {
  const raw = hours('2026-11-17T08:00:00Z', 14 * 24)
  raw.hourly.snowfall_icon_seamless.fill(null, 1 + 7 * 24 + 1)
  const dates = forecastDates('2026-11-17T17:00:00Z', raw.timezone, 14)
  const data = { dates, ...aggregateHourly(raw, dates, raw.timezone) } as Forecast
  const week = slicePeriod(data, 0, 7)
  assert.ok(Math.abs(total(week, 'icon_seamless')! - 7 * 24 * 2.54) < 1e-9)
  assert.equal(week.modelStatus.icon_seamless, '数据完整')
  assert.equal(total(data, 'icon_seamless'), null)
  const second = slicePeriod(data, 7, 14)
  assert.deepEqual(second.dates, dates.slice(7))
  assert.equal(total(second, 'icon_seamless'), null)
  assert.ok(Math.abs(total(second, 'gfs_seamless')! - 7 * 24 * 2.54) < 1e-9)
  assert.ok(Math.abs(total(slicePeriod(data, 1, 2), 'icon_seamless')! - 24 * 2.54) < 1e-9)
})

test('timeline ranges split into past days before today and forecast days from today', () => {
  const day = (dates: string[]) => ({ dates, daily: { snowfall_sum_gfs_seamless: dates.map((_, i) => i) } })
  const past = day(['p7', 'p6', 'p5', 'p4', 'p3', 'p2', 'p1'])
  const extended = { ...day(Array.from({ length: 15 }, (_, i) => `f${i}`)), modelStatus: {} } as unknown as Forecast
  const data = { ...extended, past, extended }
  const dates = (from: number, to: number) => { const r = rangeSeries(data, from, to); return [r.past?.dates.join() ?? null, r.future?.dates.join() ?? null] }
  assert.deepEqual(dates(-7, 6), ['p7,p6,p5,p4,p3,p2,p1', 'f0,f1,f2,f3,f4,f5,f6'])
  assert.deepEqual(dates(-3, -2), ['p3,p2', null])
  assert.deepEqual(dates(-1, 0), ['p1', 'f0'])
  assert.deepEqual(dates(8, 14), [null, 'f8,f9,f10,f11,f12,f13,f14'])
})
