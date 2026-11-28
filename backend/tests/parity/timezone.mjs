import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aggregatePeriods } from '../../../src/weather.ts'
import { forecastWindow } from '../../../worker/forecast-store.mjs'

const backend = fileURLToPath(new URL('../../', import.meta.url))
const day = 86_400_000

function calendar() {
  const catalog = JSON.parse(readFileSync(join(backend, 'catalog.json')))
  const dates = Array.from({ length: 730 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + day * i).toISOString().slice(0, 10))
  const zones = {}
  for (const tz of [...new Set(catalog.resorts.map(r => r.timezone))].sort()) {
    const raw = { timezone: tz, hourly_units: { time: 'unixtime' }, hourly: { time: [0] } }
    const { periods } = aggregatePeriods(raw, dates, tz)
    zones[tz] = dates.map((date, i) => {
      const midnight = Date.parse(date)
      const { start, end } = forecastWindow(midnight + day / 2, tz)
      const daylight = periods[i * 2], night = periods[i * 2 + 1]
      assert.equal(daylight.end, night.start)
      return [start, end, daylight.start / 1000, night.start / 1000, night.end / 1000]
    })
  }
  const index = JSON.parse(readFileSync(join(backend, 'tests/fixtures/recorded/index.json')))
  const halfHourWindows = Object.fromEntries(index.page.filter(p => p.custom).map(({ custom, file }) => [file, forecastWindow(index.recordedAt, custom.timezone)]))
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--offline', '--format-version', '1'], {
    cwd: backend, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }))
  const bundle = metadata.packages.find(p => p.name === 'jiff-tzdb')
  const version = readFileSync(join(dirname(bundle.manifest_path), 'tzname.rs'), 'utf8').match(/VERSION: &str = "([^"]+)"/)[1]
  return { nodeTzdb: process.versions.tz, jiffTzdb: version, zones, halfHourWindows }
}

process.stdout.write(JSON.stringify(calendar()))
