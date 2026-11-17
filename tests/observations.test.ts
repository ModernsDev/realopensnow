import test from 'node:test'
import assert from 'node:assert/strict'
import { amedasReadings, awdbReadings, cocorahsReadings, expiredObservation } from '../src/observations.ts'

test('AMeDAS distinguishes valid zero and unavailable measurements at the latest completed hour', () => {
  const readings = amedasReadings({
    '20261118031000': { snow24h: [4, 0], snow: [9, 0] },
    '20261118040000': { snow24h: [0, 0], snow: [8, 1] },
    '20261118050000': { snow24h: [7, 0], snow: [8, 0] },
  }, Date.parse('2026-11-17T19:20:00Z'))

  assert.deepEqual(readings, {
    newSnow: { cm: 0, observedAt: Date.parse('2026-11-17T19:00:00Z') },
    depth: null,
  })
})

test('AWDB uses the direct SNWD series and the station timestamp offset', () => {
  const series = (ordinal: number, value: number) => ({
    stationElement: { elementCode: 'SNWD', ordinal, durationName: 'HOURLY', storedUnitCode: 'in', derivedData: false },
    values: [{ date: '2026-11-17 11:00', value, qcFlag: 'V' }],
  })
  const readings = awdbReadings([{ stationTriplet: '766:UT:SNTL', data: [series(2, 23), series(1, 10)] }],
    '766:UT:SNTL', Date.parse('2026-11-17T19:35:00Z'))

  assert.deepEqual(readings, { newSnow: null, depth: { cm: 25.4, observedAt: Date.parse('2026-11-17T19:00:00Z') } })
  assert.equal(expiredObservation(readings.depth!, Date.parse('2026-11-17T21:59:59Z')), false)
  assert.equal(expiredObservation(readings.depth!, Date.parse('2026-11-17T22:00:00Z')), true)
})

test('CoCoRaHS daily reports use local observation time and preserve trace snowfall', () => {
  const readings = cocorahsReadings({
    obsDateTime: '2026-11-17T06:00:00+00:00',
    depthOfSnowfall: 0, depthOfSnowfallIsTrace: true,
    depthOfSnowOnGround: 1, depthOfSnowOnGroundIsTrace: false,
  }, Date.parse('2026-11-17T19:00:00Z'))

  const observedAt = Date.parse('2026-11-17T11:00:00Z')
  assert.deepEqual(readings, { newSnow: { cm: 0, trace: true, observedAt }, depth: { cm: 2.54, observedAt } })
  assert.equal(expiredObservation(readings.newSnow!, observedAt + 30 * 3600000, 30), true)
})
