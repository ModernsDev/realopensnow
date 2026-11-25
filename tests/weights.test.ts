import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWeights, saveWeights } from '../src/weights.ts'
import { defaultWeights, value, type Forecast } from '../src/weather.ts'

test('weights round-trip through a cookie; corrupt, all-zero and blocked cookies are reported', () => {
  const weights = { ecmwf_ifs025: 0, gfs_seamless: 60, icon_seamless: 20 }
  let jar = 'other=1'
  const target = { get cookie() { return jar }, set cookie(v) { jar = `other=1; ${v.split(';')[0]}` } }
  assert.equal(saveWeights(weights, target, true), null)
  assert.deepEqual(readWeights(jar), { weights, error: null })
  assert.deepEqual(readWeights(''), { weights: defaultWeights, error: null })
  for (const bad of ['%', 'null', '{}', encodeURIComponent(JSON.stringify({ ecmwf_ifs025: 0, gfs_seamless: 0, icon_seamless: 0 })), encodeURIComponent(JSON.stringify({ ...weights, gfs_seamless: 101 }))]) {
    const result = readWeights(`snow-weights=${bad}`)
    assert.equal(result.weights, defaultWeights)
    assert.ok(result.error)
  }
  assert.ok(saveWeights(weights, { get cookie() { return '' }, set cookie(_) {} }, true))
})

test('custom weights drive the blend; disabled models are ignored and a sole enabled model stands alone', () => {
  const data = { dates: ['a', 'b'], daily: { snow_ecmwf_ifs025: [10, 10], snow_gfs_seamless: [20, null], snow_icon_seamless: [40, 40] } } as unknown as Forecast
  const blend = (ecmwf_ifs025: number, gfs_seamless: number, icon_seamless: number, i: number) => value({ ...data, weights: { ecmwf_ifs025, gfs_seamless, icon_seamless } }, 'snow', 'weighted', i)
  assert.equal(blend(0, 60, 20, 0), 25)
  assert.equal(blend(0, 60, 20, 1), null)
  assert.equal(blend(100, 0, 0, 0), 10)
  assert.equal(blend(0, 100, 0, 1), null)
})
