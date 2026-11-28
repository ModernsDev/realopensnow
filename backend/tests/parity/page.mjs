import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { writeFixture } from './fixture.mjs'
import { resorts } from '../../../src/catalog.ts'
import { fixed, inZone, localDate, models, pageForecast, requestZone, snow } from '../../../src/weather.ts'
import { imperial, metric, temp } from '../../../src/units.ts'

const recorded = new URL('../fixtures/recorded/', import.meta.url)
const expected = new URL('../fixtures/expected/pages.json', import.meta.url)
const read = name => JSON.parse(readFileSync(new URL(name, recorded)))

function location(entry) {
  if (entry.custom) {
    const { lat, lon, elevation, timezone } = entry.custom
    const point = { id: 'custom-point', coordinates: { value: { lat, lon } }, elevation: { value: elevation } }
    return [{ id: 'custom-resort', timezone, points: [point] }, point]
  }
  const resort = resorts.find(r => r.id === entry.resort)
  return [resort, resort.points.find(p => p.id === entry.point)]
}

function applyEdits(data, edits) {
  for (const [op, name, index, value] of edits) {
    if (op === 'shift') data.hourly.time = data.hourly.time.map(t => t + index)
    else if (op === 'zone') data.timezone = name
    else if (op === 'remove') delete data.hourly[name]
    else if (op === 'unit') data.hourly_units[name] = value
    else if (op === 'fill') data.hourly[name].fill(value, index)
    else if (op === 'set') data.hourly[name][index] = value
    else throw new Error(op)
  }
  return data
}

export function generatePages() {
  const index = read('index.json')
  const cases = []
  const numbers = new Set()
  const originalNow = Date.now
  try {
    for (const entry of index.page) {
      const [resort, point] = location(entry)
      if (['America/Vancouver', 'America/Winnipeg', 'America/Edmonton'].includes(resort.timezone)) continue
      const raw = read(entry.file)
      const query = { resortId: resort.id, pointId: point.id, ...point.coordinates.value, elevation: point.elevation.value, timezone: resort.timezone }
      function run(name, now, edits = [], invalid = false) {
        Date.now = () => now
        const data = inZone(applyEdits(structuredClone(raw), edits), requestZone(resort.timezone, now), resort.timezone)
        const requested = new Date(now).toISOString()
        const fetched = new Date(now + 257).toISOString()
        const sample = { name, file: entry.file, query, requested, fetched, edits }
        const forecast = () => pageForecast(data, resort, point, requested, fetched)
        if (invalid) {
          assert.throws(forecast, /时区|时间轴|time zone|hourly time axis/)
          sample.invalid = true
        } else {
          const { report, ...output } = forecast()
          sample.payload = output
          for (const series of [output, output.extended, output.past, output.periods]) {
            for (const column of Object.values(series.daily)) for (const n of column) numbers.add(n)
          }
        }
        cases.push(sample)
      }
      run(entry.file, index.recordedAt)
      const edits = []
      for (const field of ['snowfall', 'temperature_2m', 'wind_gusts_10m']) {
        const key = field + '_' + models[0].id
        edits.push(['fill', key, 0, field === 'temperature_2m' ? -2 : 1], ['fill', key, 16 * 24, null])
      }
      for (const key of Object.keys(raw.hourly).filter(k => k.endsWith('_gfs_seamless'))) edits.push(['remove', key])
      edits.push(['unit', 'snowfall_icon_seamless', null, 'inch'])
      const midnight = raw.hourly.time.findIndex((s, i) => i > 240 && localDate(s * 1000, resort.timezone) !== localDate((s - 3600) * 1000, resort.timezone))
      assert.ok(midnight > 0)
      edits.push(['set', 'wind_gusts_10m_ecmwf_ifs025', midnight, 999])
      run(entry.file + '-missing-and-midnight', index.recordedAt, edits)
      const transitions = entry.point === 'stowe-top' ? ['2026-03-08', '2026-11-01']
        : entry.point === 'grands-montets-mid' ? ['2026-03-29', '2026-10-25']
          : entry.custom ? ['2026-07-01'] : []
      for (const date of transitions) {
        const now = Date.parse(date + 'T05:15:53.147Z')
        const edits = [['shift', 'time', Math.round((now - index.recordedAt) / 3600000) * 3600]]
        if (entry.custom) {
          edits[0][2] -= 3600
          edits.push(['zone', requestZone(resort.timezone, now)])
        }
        run(entry.file + '-' + date, now, edits)
      }
      if (entry.custom) {
        run('wrong-response-zone', index.recordedAt, [['zone', 'Etc/GMT+4']], true)
        run('half-hour-axis', index.recordedAt, [['zone', 'America/St_Johns'], ['shift', 'time', 1800]], true)
      }
    }
  } finally {
    Date.now = originalNow
  }
  const formatted = Array.from(numbers, n => ({
    n, fixed: fixed(n), snow: [snow(n, 'cm'), snow(n, 'in')], temp: [temp(n, metric), temp(n, imperial)],
  }))
  writeFixture(expected, { cases, formatted })
}
