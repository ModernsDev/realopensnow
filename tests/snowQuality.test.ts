import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snowLevel, snowQuality, type SnowGrade } from '../src/snowQuality.ts'
import type { DailySeries } from '../src/weather.ts'

function series(...days: [number | null, number | null, number | null][]): DailySeries {
  return {
    dates: days.map((_, i) => `2026-11-${10 + i}`),
    daily: {
      snowfall_sum_gfs_seamless: days.map(([snow]) => snow),
      rain_sum_gfs_seamless: days.map(([, rain]) => rain),
      wet_snowfall_sum_gfs_seamless: days.map(([, , wet]) => wet),
    },
  }
}

test('snow grades follow precipitation priority and exact thresholds', () => {
  const cases: [number | null, number | null, number | null, SnowGrade][] = [
    [null, 1, 0, 'unknown'], [0, null, 0, 'unknown'], [0, 1, null, 'unknown'],
    [0, 1, 0, 'rain'], [7, 10, 7, 'rain'],
    [0.09, 0.9, 0, 'none'], [0.1, 0, 0.1, 'light'], [2.49, 1, 0, 'light'],
    [2.5, 0, 0, 'good'], [2.5, 1, 0, 'wet'], [5, 0, 2.5, 'wet'],
    [12.49, 0, 0, 'good'], [12.5, 0, 2.5, 'good'], [12.5, 0, 2.49, 'excellent'],
  ]
  for (const [snow, rain, wet, grade] of cases) {
    assert.deepEqual(snowQuality(series([snow, rain, wet]), 0), { grade, wetBefore: false }, JSON.stringify([snow, rain, wet]))
  }
})

test('only the preceding grade can block excellent, including after rain or wet snow', () => {
  const f = series([0, 1, 0], [15, 0, 0], [15, 0, 0], [5, 0, 3], [15, 0, 0], [0, 1, 0], [null, 0, 0], [15, 0, 0])
  assert.deepEqual(f.dates.map((_, i) => snowQuality(f, i)), [
    { grade: 'rain', wetBefore: false },
    { grade: 'good', wetBefore: true },
    { grade: 'excellent', wetBefore: false },
    { grade: 'wet', wetBefore: false },
    { grade: 'good', wetBefore: true },
    { grade: 'rain', wetBefore: false },
    { grade: 'unknown', wetBefore: true },
    { grade: 'excellent', wetBefore: false },
  ])
})

test('snow grades use the weighted amounts and old snapshots yield unknown', () => {
  const f = series([5, 0, 0])
  f.daily.snowfall_sum_ecmwf_ifs025 = [20]
  f.weights = { gfs_seamless: 3, ecmwf_ifs025: 1 }
  assert.equal(snowQuality(f, 0).grade, 'good')
  f.weights = { gfs_seamless: 1, ecmwf_ifs025: 3 }
  assert.equal(snowQuality(f, 0).grade, 'excellent')
  const archived = { dates: f.dates, daily: { snowfall_sum_gfs_seamless: [5] } }
  assert.deepEqual(snowQuality(archived, 0), { grade: 'unknown', wetBefore: false })
  assert.equal(snowLevel(archived, 0), null)
})

test('snow level subtracts 300 m from both weighted heights and needs both endpoints', () => {
  const f = {
    dates: ['2026-11-10', '2026-11-11', '2026-11-12'],
    daily: {
      freezing_level_height_min_gfs_seamless: [100, null, 100],
      freezing_level_height_min_icon_seamless: [300, null, 300],
      freezing_level_height_max_gfs_seamless: [700, 700, null],
      freezing_level_height_max_icon_seamless: [900, 900, null],
    },
  }
  assert.deepEqual(snowLevel(f, 0), { low: -100, high: 500 })
  assert.equal(snowLevel(f, 1), null)
  assert.equal(snowLevel(f, 2), null)
})
