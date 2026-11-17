import { test } from 'node:test'
import assert from 'node:assert/strict'
import { favoritesKey, readFavorites, saveFavorites } from '../src/favorites.ts'

const memory = (raw: string | null = null) => {
  const values = new Map<string, string>(raw === null ? [] : [[favoritesKey, raw]])
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

test('favorites persist by stable ID, retain empty lists and deduplicate stale records', () => {
  const storage = memory()
  assert.deepEqual(readFavorites(() => storage).ids, ['alta', 'snowbird', 'niseko', 'chamonix'])
  assert.equal(saveFavorites(['stowe', 'stowe', 'alta', 'unknown'], () => storage), null)
  assert.deepEqual(readFavorites(() => storage), { ids: ['stowe', 'alta'], error: null })
  saveFavorites([], () => storage)
  assert.deepEqual(readFavorites(() => storage), { ids: [], error: null })
  const stale = readFavorites(() => memory('["alta","unknown","alta","stowe"]'))
  assert.deepEqual(stale.ids, ['alta', 'stowe'])
  assert.ok(stale.error)
})

test('malformed and inaccessible storage reports errors without overwriting saved records', () => {
  for (const raw of ['{broken', 'null', '{}', '[1,"alta"]', '"alta"']) {
    const storage = memory(raw)
    const result = readFavorites(() => storage)
    assert.deepEqual(result.ids, [])
    assert.ok(result.error)
    assert.equal(storage.getItem(favoritesKey), raw)
  }
  const denied = () => { throw new DOMException('denied', 'SecurityError') }
  assert.ok(readFavorites(denied).error)
  assert.match(saveFavorites(['alta'], denied)!, /仅在本页有效/)
  const quota = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError') } }
  assert.match(saveFavorites(['alta'], () => quota)!, /重试保存/)
  const recovered = memory()
  assert.equal(saveFavorites(['alta'], () => recovered), null)
  assert.deepEqual(readFavorites(() => recovered), { ids: ['alta'], error: null })
})
