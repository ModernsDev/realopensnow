import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readHidden, readWeights, saveSettings } from '../src/weights.ts'
import { availableModels, defaultWeights, spread, value, type Forecast } from '../src/weather.ts'

test('weights and hidden models round-trip through cookies; corrupt, all-zero and blocked cookies are reported', () => {
  const weights = { ...defaultWeights, ecmwf_ifs025: 0, gfs_seamless: 60, gfs_hrrr: 0 }
  let jar = 'other=1'
  const target = { get cookie() { return jar }, set cookie(v) { const [name] = v.split('='); jar = [...jar.split('; ').filter(part => !part.startsWith(`${name}=`)), v.split(';')[0]].join('; ') } }
  assert.equal(saveSettings(weights, ['gfs_hrrr', 'icon_d2'], target, true), null)
  assert.deepEqual(readWeights(jar), { weights, error: null })
  assert.deepEqual(readHidden(jar), { hidden: ['gfs_hrrr', 'icon_d2'], error: null })
  assert.deepEqual(readWeights(`snow-weights=${encodeURIComponent(JSON.stringify({ ecmwf_ifs025: 0, gfs_seamless: 60, icon_seamless: 20 }))}`).weights, { ...defaultWeights, ecmwf_ifs025: 0, gfs_seamless: 60, icon_seamless: 20 })
  for (const bad of ['%', '{}', encodeURIComponent('["nope"]'), encodeURIComponent(JSON.stringify(Object.keys(defaultWeights)))]) assert.ok(readHidden(`snow-hidden=${bad}`).error)
  assert.deepEqual(readWeights(''), { weights: defaultWeights, error: null })
  for (const bad of ['%', 'null', '[]', encodeURIComponent(JSON.stringify(Object.fromEntries(Object.keys(defaultWeights).map(id => [id, 0])))), encodeURIComponent(JSON.stringify({ ...weights, gfs_seamless: 101 })), encodeURIComponent(JSON.stringify({ unknown_model: 5 }))]) {
    const result = readWeights(`snow-weights=${bad}`)
    assert.equal(result.weights, defaultWeights)
    assert.ok(result.error)
  }
  assert.ok(saveSettings(weights, [], { get cookie() { return '' }, set cookie(_) {} }, true))
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
