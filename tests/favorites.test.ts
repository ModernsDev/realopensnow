import { test } from 'node:test'
import assert from 'node:assert/strict'
import { favoritesKey, readFavorites, saveFavorites } from '../src/favorites.ts'

const browser = (initial = '') => {
  let value = initial
  return {
    get cookie() { return value },
    set cookie(next: string) {
      const [pair] = next.split(';')
      const name = pair.split('=')[0]
      const rest = value.split('; ').filter(part => part && !part.startsWith(`${name}=`))
      value = (next.includes('Max-Age=0') ? rest : [...rest, pair]).join('; ')
    },
  }
}
const local = (raw: string | null = null) => {
  let value = raw
  const store = { getItem: () => value, setItem: (_: string, next: string) => { value = next } }
  return () => store
}
const validIds = new Set(['alta', 'snowbird', 'niseko', 'chamonix', 'stowe', 'custom-0b6c3f0e-5d0a-4a52-9a3f-2f7d6a1c9e11'])

test('favorites live in local storage, including an empty list', () => {
  const storage = local()
  assert.deepEqual(readFavorites(browser(), storage, validIds).ids, ['alta', 'snowbird', 'niseko', 'chamonix'])
  assert.equal(saveFavorites(['stowe', 'stowe', 'alta', 'unknown'], storage, validIds), null)
  assert.deepEqual(readFavorites(browser(), storage, validIds), { ids: ['stowe', 'alta'], error: null })
  saveFavorites([], storage, validIds)
  assert.deepEqual(readFavorites(browser(), storage, validIds), { ids: [], error: null })
  const stale = readFavorites(browser(), local('["alta","unknown","alta"]'), validIds)
  assert.deepEqual(stale.ids, ['alta'])
  assert.ok(stale.error)
  assert.ok(readFavorites(browser(), local('{broken'), validIds).error)
})

test('a legacy cookie list moves into storage once and the cookie is cleared', () => {
  const jar = browser(`x=1; ${favoritesKey}=stowe.alta`)
  const storage = local('["niseko"]')
  assert.deepEqual(readFavorites(jar, storage, validIds).ids, ['stowe', 'alta'])
  assert.equal(jar.cookie, 'x=1')
  assert.deepEqual(readFavorites(jar, storage, validIds).ids, ['stowe', 'alta'])
})

test('blocked storage reports unsaved changes', () => {
  const denied = () => ({ getItem(): string | null { throw new Error('denied') }, setItem() { throw new Error('denied') } })
  assert.match(saveFavorites(['alta'], denied, validIds)!, /仅在本页有效/)
  assert.ok(readFavorites(browser(), denied, validIds).error)
})
