import { test } from 'node:test'
import assert from 'node:assert/strict'
import { favoritesKey, readFavorites, saveFavorites } from '../src/favorites.ts'
import { resorts } from '../src/catalog.ts'
// @ts-expect-error Worker modules have no type declarations
import { renewedFavoritesCookie } from '../worker/favorites-cookie.mjs'

const browser = (initial = '') => {
  let value = initial
  return { get cookie() { return value }, set cookie(next: string) { value = next.split(';')[0] } }
}
const storage = (raw: string | null = null) => {
  let value = raw
  return { getItem: () => value, removeItem: () => { value = null } }
}
const none = () => storage()

test('each browser cookie holds its own list, including an empty one', () => {
  const a = browser()
  const b = browser()
  assert.equal(saveFavorites(['stowe', 'stowe', 'alta', 'unknown'], a), null)
  assert.deepEqual(readFavorites(a, none), { ids: ['stowe', 'alta'], error: null })
  assert.deepEqual(readFavorites(b, none).ids, ['alta', 'snowbird', 'niseko', 'chamonix'])
  saveFavorites([], a)
  assert.deepEqual(readFavorites(a, none), { ids: [], error: null })
  const stale = readFavorites(browser(`x=1; ${favoritesKey}=alta.unknown.alta.stowe`), none)
  assert.deepEqual(stale.ids, ['alta', 'stowe'])
  assert.ok(stale.error)
})

test('legacy list migrates once and never overrides the cookie', () => {
  const jar = browser()
  const old = storage('["stowe"]')
  assert.deepEqual(readFavorites(jar, () => old), { ids: ['stowe'], error: null })
  assert.equal(old.getItem(), null)
  assert.deepEqual(readFavorites(jar, () => storage('["alta"]')).ids, ['stowe'])
  const blocked = { get cookie() { return '' }, set cookie(_: string) {} }
  const kept = storage('["stowe"]')
  assert.ok(readFavorites(blocked, () => kept).error)
  assert.equal(kept.getItem(), '["stowe"]')
  const corrupt = storage('{broken')
  assert.ok(readFavorites(browser(), () => corrupt).error)
  assert.equal(corrupt.getItem(), '{broken')
})

test('blocked cookies report unsaved changes', () => {
  const ignored = { get cookie() { return '' }, set cookie(_: string) {} }
  assert.match(saveFavorites(['alta'], ignored)!, /仅在本页有效/)
  const denied = { get cookie(): string { throw new Error('denied') }, set cookie(_: string) { throw new Error('denied') } }
  assert.match(saveFavorites(['alta'], denied)!, /重试保存/)
  assert.ok(readFavorites(denied, none).error)
})

test('worker renews only well-formed lists', () => {
  const jar = browser()
  saveFavorites(resorts.map(r => r.id), jar)
  assert.ok(renewedFavoritesCookie(`x=1; ${jar.cookie}; y=2`).startsWith(`${jar.cookie}; Path=/; Max-Age=`))
  assert.ok(renewedFavoritesCookie('snow-favorites='))
  for (const bad of [null, 'x=1', 'other-snow-favorites=alta', 'snow-favorites=<b>']) assert.equal(renewedFavoritesCookie(bad), null)
})
