import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultWeights } from '../src/weather.ts'
import { metric } from '../src/units.ts'
import { defaultChartLayers } from '../src/chartLayers.ts'
// @ts-expect-error Worker modules have no type declarations
import { validUserData } from '../worker/accounts.mjs'

const location = { id: 'custom-a', name: '后山', lat: 45, lon: 7, elevation: 2000, timezone: 'Europe/Rome', createdOn: '2026-11-26' }

test('cloud data accepts catalog and own custom ids only', () => {
  assert.ok(validUserData({ favorites: ['alta', 'custom-a'], customLocations: [location], weights: defaultWeights, hidden: [], units: metric, chartLayers: defaultChartLayers }))
  assert.ok(!validUserData({ favorites: ['custom-a'], customLocations: [], weights: defaultWeights, hidden: [], units: metric, chartLayers: defaultChartLayers }))
  assert.ok(!validUserData({ favorites: ['alta', 'alta'], customLocations: [], weights: defaultWeights, hidden: [], units: metric, chartLayers: defaultChartLayers }))
  assert.ok(!validUserData({ favorites: [], customLocations: [location, location], weights: defaultWeights, hidden: [], units: metric, chartLayers: defaultChartLayers }))
  assert.ok(!validUserData({ favorites: [], customLocations: [], weights: {}, hidden: [], units: metric, chartLayers: defaultChartLayers }))
  assert.ok(!validUserData({ favorites: [], customLocations: [], weights: defaultWeights, hidden: ['nope'], units: metric, chartLayers: defaultChartLayers }))
  assert.ok(!validUserData({ favorites: [], customLocations: [], weights: defaultWeights, hidden: [], units: { snow: 'cm' }, chartLayers: defaultChartLayers }))
  assert.ok(!validUserData({ favorites: [], customLocations: [], weights: defaultWeights, hidden: [], units: metric, chartLayers: defaultChartLayers, extra: 1 }))
  assert.ok(!validUserData({ favorites: [], customLocations: [], weights: defaultWeights, hidden: [], units: metric }))
  assert.ok(!validUserData({ favorites: [], customLocations: [], weights: defaultWeights, hidden: [], units: metric, chartLayers: { ...defaultChartLayers, range: 'no' } }))
})
