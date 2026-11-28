import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resorts } from '../src/catalog.ts'
import { refreshFavorites } from '../worker/forecast-snapshots.mjs'

function fakeDb(favorites: string[]) {
  const inserted: string[] = []
  return {
    inserted,
    prepare: (sql: string) => ({
      all: async () => ({ results: favorites.map(resort_id => ({ resort_id })) }),
      bind: (point: string) => ({ first: async () => { assert.match(sql, /INSERT INTO forecast_snapshots/); inserted.push(point); return { id: inserted.length } } }),
    }),
  }
}

test('scheduled refresh snapshots every queryable point of favorited resorts only', async t => {
  const requested: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string) => { requested.push(url); return new Response('{}', { status: 500 }) })
  const failing = fakeDb(['alta', 'alta', 'missing-custom-id'])
  const summary = await refreshFavorites({ DB: failing })
  const alta = resorts.find(r => r.id === 'alta')!
  assert.equal(requested.length, alta.points.length)
  assert.deepEqual({ saved: summary.saved, failed: summary.failed }, { saved: 0, failed: alta.points.length })
  assert.deepEqual(failing.inserted, [])
})

test('scheduled refresh stops fetching once Open-Meteo rate limits', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 429 }) })
  const summary = await refreshFavorites({ DB: fakeDb(resorts.slice(0, 6).map(r => r.id)) })
  assert.equal(summary.limited, true)
  assert.equal(calls, 4)
  assert.ok(summary.skipped > 0)
})
