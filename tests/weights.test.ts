import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readHidden, readWeights, saveSettings } from '../src/weights.ts'
import { availableModels, defaultWeights, spread, value, type Forecast } from '../src/weather.ts'

const local = (entries: Record<string, string> = {}) => {
  const store = { getItem: (k: string) => entries[k] ?? null, setItem: (k: string, v: string) => { entries[k] = v } }
  return () => store
}
const jar = (cookie = '') => ({ cookie })

test('weights and hidden models round-trip through storage; corrupt and all-zero values are reported; legacy cookies migrate', () => {
  const weights = { ...defaultWeights, ecmwf_ifs025: 0, gfs_seamless: 60, gfs_hrrr: 0 }
  const storage = local()
  assert.equal(saveSettings(weights, ['gfs_hrrr', 'icon_d2'], storage), null)
  assert.deepEqual(readWeights(jar(), storage), { weights, error: null })
  assert.deepEqual(readHidden(jar(), storage), { hidden: ['gfs_hrrr', 'icon_d2'], error: null })
  const legacy = jar(`snow-weights=${encodeURIComponent(JSON.stringify({ ecmwf_ifs025: 0, gfs_seamless: 60, icon_seamless: 20 }))}`)
  const migrated = local()
  assert.deepEqual(readWeights(legacy, migrated).weights, { ...defaultWeights, ecmwf_ifs025: 0, gfs_seamless: 60, icon_seamless: 20 })
  assert.equal(legacy.cookie, 'snow-weights=; Path=/; Max-Age=0')
  for (const bad of ['{}', '["nope"]', JSON.stringify(Object.keys(defaultWeights))]) assert.ok(readHidden(jar(), local({ 'snow-hidden': bad })).error)
  assert.deepEqual(readWeights(jar(), local()), { weights: defaultWeights, error: null })
  for (const bad of ['{', 'null', '[]', JSON.stringify(Object.fromEntries(Object.keys(defaultWeights).map(id => [id, 0]))), JSON.stringify({ ...weights, gfs_seamless: 101 }), JSON.stringify({ unknown_model: 5 })]) {
    const result = readWeights(jar(), local({ 'snow-weights': bad }))
    assert.equal(result.weights, defaultWeights)
    assert.ok(result.error)
  }
  assert.ok(saveSettings(weights, [], () => ({ getItem: () => null, setItem() { throw new Error('denied') } })))
})

test('custom weights drive the blend; disabled models are ignored and a sole enabled model stands alone', () => {
  const data = { dates: ['a', 'b'], daily: { snow_ecmwf_ifs025: [10, 10], snow_gfs_seamless: [20, null], snow_icon_seamless: [40, 40] } } as unknown as Forecast
  const blend = (ecmwf_ifs025: number, gfs_seamless: number, icon_seamless: number, i: number) => value({ ...data, weights: { ...defaultWeights, ecmwf_ifs025, gfs_seamless, icon_seamless } }, 'snow', 'weighted', i)
  assert.equal(blend(0, 60, 20, 0), 25)
  assert.equal(blend(0, 60, 20, 1), null)
  assert.equal(blend(100, 0, 0, 0), 10)
  assert.equal(blend(0, 100, 0, 1), null)
})

test('every model joins the blend by its weight; hidden models leave display and ranges but not the blend', () => {
  const data = { dates: ['a'], daily: { snow_ecmwf_ifs025: [10], snow_ncep_nbm_conus: [40], snow_gfs_hrrr: [100] } } as unknown as Forecast
  const weights = { ...defaultWeights, ecmwf_ifs025: 50, ncep_nbm_conus: 50, gfs_hrrr: 0 }
  assert.equal(value({ ...data, weights }, 'snow', 'weighted', 0), 25)
  assert.equal(value({ ...data, weights: defaultWeights }, 'snow', 'weighted', 0), (10 * 50 + 40 * 20 + 100 * 10) / 80)
  const hidden = { ...data, weights, hidden: ['ncep_nbm_conus'] }
  assert.equal(value(hidden, 'snow', 'weighted', 0), 25)
  assert.deepEqual(availableModels(hidden, 'snow').map(m => m.id), ['ecmwf_ifs025', 'gfs_hrrr'])
  assert.deepEqual(spread(hidden, 'snow', 0), { low: 10, high: 100 })
})
