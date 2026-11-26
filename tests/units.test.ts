import test from 'node:test'
import assert from 'node:assert/strict'
import { elevation, imperial, metric, readUnits, temp, wind } from '../src/units.ts'

test('unit conversions', () => {
  assert.equal(temp(-10, imperial), '14')
  assert.equal(temp(-10, metric), '-10')
  assert.equal(temp(null, imperial), '—')
  assert.equal(wind(100, imperial), '62.1')
  assert.equal(elevation(3048, imperial), '10,000')
})

test('stored units fall back to metric when missing or invalid', () => {
  const store = (v: string | null) => () => ({ getItem: () => v }) as unknown as Storage
  assert.deepEqual(readUnits(store(null)), metric)
  assert.deepEqual(readUnits(store('{"snow":"in"}')), metric)
  assert.deepEqual(readUnits(store(JSON.stringify({ ...metric, temperature: '°F' }))), { ...metric, temperature: '°F' })
})
