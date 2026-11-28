import { readFileSync } from 'node:fs'
import { refreshFavorites } from '../worker/forecast-store.mjs'

const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
const account = /"account_id": "([^"]+)"/.exec(config)[1]
const database = /"database_id": "([^"]+)"/.exec(config)[1]
const token = process.env.CLOUDFLARE_D1_TOKEN
if (!token) throw new Error('CLOUDFLARE_D1_TOKEN is not set')

async function query(body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const data = await response.json()
  if (!response.ok || !data.success) throw new Error(`D1 HTTP ${response.status}: ${JSON.stringify(data.errors)}`)
  return data.result
}

const statement = (sql, params = []) => ({
  sql, params,
  bind: (...values) => statement(sql, values),
  first: async () => (await query({ sql, params }))[0].results[0] ?? null,
  all: async () => ({ results: (await query({ sql, params }))[0].results }),
  run: async () => ({ meta: (await query({ sql, params }))[0].meta }),
})

const DB = {
  prepare: sql => statement(sql),
  batch: async list => (await query({ batch: list.map(({ sql, params }) => ({ sql, params })) })).map(({ results, meta }) => ({ results, meta })),
}

const summary = await refreshFavorites({ DB }, Date.now())
if (summary.errors) process.exitCode = 1
