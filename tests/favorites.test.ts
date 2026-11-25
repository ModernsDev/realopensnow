import { test } from 'node:test'
import assert from 'node:assert/strict'
import { favoritesKey, readFavorites, saveFavorites } from '../src/favorites.ts'

const validIds = new Set(['alta', 'snowbird', 'niseko', 'chamonix', 'stowe', 'custom-one'])
const memory = (raw: string | null = null) => {
  const values = new Map<string, string>(raw === null ? [] : [[favoritesKey, raw]])
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

test('favorites persist by stable ID, retain empty lists and deduplicate stale records', () => {
  const storage = memory()
  assert.deepEqual(readFavorites(() => storage, validIds).ids, ['alta', 'snowbird', 'niseko', 'chamonix'])
  assert.equal(saveFavorites(['stowe', 'stowe', 'alta', 'unknown'], () => storage, validIds), null)
  assert.deepEqual(readFavorites(() => storage, validIds), { ids: ['stowe', 'alta'], error: null })
  saveFavorites([], () => storage, validIds)
  assert.deepEqual(readFavorites(() => storage, validIds), { ids: [], error: null })
  const stale = readFavorites(() => memory('["alta","unknown","alta","stowe"]'), validIds)
  assert.deepEqual(stale.ids, ['alta', 'stowe'])
  assert.ok(stale.error)
})

test('malformed and inaccessible storage reports errors without overwriting saved records', () => {
  for (const raw of ['{broken', 'null', '{}', '[1,"alta"]', '"alta"']) {
    const storage = memory(raw)
    const result = readFavorites(() => storage, validIds)
    assert.deepEqual(result.ids, [])
    assert.ok(result.error)
    assert.equal(storage.getItem(favoritesKey), raw)
  }
  const denied = () => { throw new DOMException('denied', 'SecurityError') }
  assert.ok(readFavorites(denied, validIds).error)
  assert.match(saveFavorites(['alta'], denied, validIds)!, /仅在本页有效/)
  const quota = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError') } }
  assert.match(saveFavorites(['alta'], () => quota, validIds)!, /重试保存/)
  const recovered = memory()
  assert.equal(saveFavorites(['alta'], () => recovered, validIds), null)
  assert.deepEqual(readFavorites(() => recovered, validIds), { ids: ['alta'], error: null })
})

test('custom favorites follow the supplied IDs on read and write', () => {
  const storage = memory()
  assert.equal(saveFavorites(['custom-one', 'custom-unknown', 'alta'], () => storage, validIds), null)
  assert.deepEqual(readFavorites(() => storage, validIds), { ids: ['custom-one', 'alta'], error: null })
  const result = readFavorites(() => storage, new Set(['alta']))
  assert.deepEqual(result.ids, ['alta'])
  assert.ok(result.error)
})
