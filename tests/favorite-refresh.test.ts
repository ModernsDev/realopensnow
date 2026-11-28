import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'
import { resorts } from '../src/catalog.ts'
import { models } from '../src/weather.ts'
import { forecastWindow, latestForecast, modelMembers, refreshFavorites, refreshPoint } from '../worker/forecast-store.mjs'

const hour = 3600
const stowe = resorts.find(r => r.id === 'stowe')!
const base = stowe.points[0]
const start = Date.parse('2026-11-28T00:20:00Z')
const firstRun = Date.parse('2026-11-27T18:00:00Z') / 1000

function database() {
  const db = new DatabaseSync(':memory:')
  for (const file of ['0002_forecast_snapshots', '0005_forecast_store']) db.exec(readFileSync(`drizzle/${file}.sql`, 'utf8').replaceAll('--> statement-breakpoint', ''))
  db.exec('CREATE TABLE user_favorites (user_id TEXT, resort_id TEXT)')
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => db.prepare(sql).get(...values as never[]) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values as never[]) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values as never[]).changes) } }),
    execute: () => /^\s*SELECT/i.test(sql) ? { results: db.prepare(sql).all(...values as never[]) } : { meta: { changes: Number(db.prepare(sql).run(...values as never[]).changes) } },
  })
  const DB = {
    prepare: (sql: string) => statement(sql),
    batch: async (list: ReturnType<typeof statement>[]) => {
      db.exec('BEGIN')
      try { const results = list.map(s => s.execute()); db.exec('COMMIT'); return results } catch (error) { db.exec('ROLLBACK'); throw error }
    },
  }
  return { db, env: { DB } }
}

type Upstream = { runs: Record<string, number>; value: number; outside: string[]; fail: string[]; requests: { models: string[]; from: number; to: number }[] }
function upstream(t: TestContext): Upstream {
  const world: Upstream = { runs: {}, value: 1, outside: ['icon_eu', 'icon_d2'], fail: [], requests: [] }
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input)
    const meta = /\/data\/(.+)\/static/.exec(url.pathname)
    if (meta) return Response.json({ last_run_initialisation_time: world.runs[meta[1]] ?? firstRun, last_run_availability_time: start / 1000 - hour })
    const requested = url.searchParams.get('models')!.split(',')
    const from = Date.parse(url.searchParams.get('start_hour') + 'Z') / 1000
    const to = Date.parse(url.searchParams.get('end_hour') + 'Z') / 1000
    world.requests.push({ models: requested, from, to })
    if (requested.some(model => world.fail.includes(model))) return new Response('{}', { status: 500 })
    const time = Array.from({ length: (to - from) / hour + 1 }, (_, i) => from + i * hour)
    const column = time.map(() => world.value)
    const covered = requested.filter(model => !world.outside.includes(model))
    const units: Record<string, string> = { time: 'unixtime' }
    const hourly: Record<string, unknown> = { time }
    for (const [variable, unit] of [['snowfall', 'cm'], ['temperature_2m', '°C'], ['wind_gusts_10m', 'km/h'], ['rain', 'mm'], ['freezing_level_height', 'm']]) {
      for (const model of covered) {
        const key = covered.length === 1 ? variable : `${variable}_${model}`
        units[key] = unit
        hourly[key] = column
      }
    }
    return Response.json({ latitude: 44.5, longitude: -72.75, elevation: Number(url.searchParams.get('elevation')), timezone: 'GMT', hourly_units: units, hourly })
  })
  return world
}
const metas = (world: Upstream) => Object.fromEntries([...new Set(Object.values(modelMembers).flat())].map(path => [path, { init: world.runs[path] ?? firstRun, available: start / 1000 - hour }]))
const clock = (t: TestContext, now = start) => t.mock.timers.enable({ apis: ['Date'], now })
const read = async (env: ReturnType<typeof database>['env']) => { const r = await latestForecast(env, base.id); return r.status === 200 ? await r.json() : r.status }

test('the forecast window matches Open-Meteo for whole-hour, half-hour and daylight-saving zones', () => {
  const at = (iso: string, zone: string) => { const w = forecastWindow(Date.parse(iso), zone); return [new Date(w.start * 1000).toISOString(), new Date(w.end * 1000).toISOString(), (w.end - w.start) / hour + 1] }
  assert.deepEqual(at('2026-11-28T00:50:00Z', 'America/St_Johns'), ['2026-11-19T03:00:00.000Z', '2026-12-13T02:00:00.000Z', 576])
  assert.deepEqual(at('2026-11-28T00:50:00Z', 'America/Los_Angeles'), ['2026-11-19T08:00:00.000Z', '2026-12-13T07:00:00.000Z', 576])
  assert.equal(at('2026-03-01T12:00:00Z', 'America/New_York')[2], 575)
  assert.equal(at('2026-10-25T12:00:00Z', 'America/New_York')[2], 577)
})

test('first run fetches the whole window per model, stores records and serves the page forecast', async t => {
  clock(t)
  const world = upstream(t)
  const { db, env } = database()
  const result = await refreshPoint(env, stowe, base, metas(world), start - start % 10_800_000)
  const window = forecastWindow(start, stowe.timezone)
  assert.deepEqual(result, { committed: true, fetched: 10, failed: 0, limited: false })
  assert.deepEqual(world.requests, [{ models: models.map(m => m.id), from: window.start, to: window.end }])
  assert.equal(db.prepare('SELECT count(*) n FROM forecast_records').get()!.n, 10)
  assert.equal(db.prepare('SELECT count(*) n FROM forecast_snapshots WHERE cron_slot IS NOT NULL').get()!.n, 1)
  const page = await read(env)
  assert.equal(page.dates.length, 7)
  assert.equal(page.extended.dates.length, 15)
  assert.equal(page.periods.dates.length, 44)
  assert.equal(page.daily.snowfall_sum_ecmwf_ifs025[0], 24)
  assert.equal(page.daily.snowfall_sum_icon_d2[0], null)
  assert.equal(page.fetched, new Date(start).toISOString())
})

test('later runs fetch only models with a new run, from the last seen run onward', async t => {
  clock(t)
  const world = upstream(t)
  const { db, env } = database()
  await refreshPoint(env, stowe, base, metas(world), null)
  world.requests.length = 0
  t.mock.timers.setTime(start + 3_600_000)
  assert.equal((await refreshPoint(env, stowe, base, metas(world), null)).fetched, 0)
  assert.deepEqual(world.requests, [])
  assert.equal((await read(env)).fetched, new Date(start + 3_600_000).toISOString())

  world.runs.ncep_hrrr_conus = firstRun + 6 * hour
  world.value = 2
  await refreshPoint(env, stowe, base, metas(world), null)
  const window = forecastWindow(start, stowe.timezone)
  assert.deepEqual(world.requests, [{ models: ['ecmwf_ifs025', 'gfs_seamless', 'gfs_hrrr'], from: firstRun, to: window.end }])
  const series = JSON.parse(db.prepare('SELECT series FROM forecast_latest').get()!.series as string)
  const split = (firstRun - window.start) / hour
  assert.deepEqual([series.models.gfs_hrrr.hourly.snowfall[split - 1], series.models.gfs_hrrr.hourly.snowfall[split]], [1, 2])
  assert.equal(series.models.ecmwf_ifs025.hourly.snowfall[split], 1)
})

test('a known new run that failed to merge blocks the stored forecast and its snapshot until retried', async t => {
  clock(t)
  const world = upstream(t)
  const { db, env } = database()
  await refreshPoint(env, stowe, base, metas(world), null)
  world.runs.ncep_nbm_conus = firstRun + 6 * hour
  world.fail = ['ncep_nbm_conus']
  t.mock.timers.setTime(start + 3_600_000)
  const result = await refreshPoint(env, stowe, base, metas(world), start)
  assert.equal(result.failed, 1)
  assert.equal(await read(env), 404)
  assert.equal(db.prepare('SELECT count(*) n FROM forecast_snapshots').get()!.n, 0)
  world.fail = []
  world.requests.length = 0
  t.mock.timers.setTime(start + 2 * 3_600_000)
  await refreshPoint(env, stowe, base, metas(world), null)
  assert.deepEqual(world.requests, [])
  t.mock.timers.setTime(start + 3 * 3_600_000 + 1)
  await refreshPoint(env, stowe, base, metas(world), null)
  assert.equal(world.requests.length, 1)
  assert.equal(typeof await read(env), 'object')
})

test('after local midnight the new tail is fetched before the forecast is served again', async t => {
  clock(t)
  const world = upstream(t)
  const { env } = database()
  await refreshPoint(env, stowe, base, metas(world), null)
  const before = forecastWindow(start, stowe.timezone)
  const next = start + 24 * 3_600_000
  t.mock.timers.setTime(next)
  assert.equal(await read(env), 404)
  world.requests.length = 0
  await refreshPoint(env, stowe, base, metas(world), null)
  const after = forecastWindow(next, stowe.timezone)
  assert.deepEqual(world.requests, [{ models: models.map(m => m.id).filter(id => !world.outside.includes(id)), from: before.end + hour, to: after.end }])
  const page = await read(env)
  assert.equal(page.periods.daily.snowfall_sum_ecmwf_ifs025.at(-1), 12)
})

test('a stale writer leaves no records or snapshots behind', async t => {
  clock(t)
  const world = upstream(t)
  const { db, env } = database()
  const slot = start - start % 10_800_000
  const racing = { DB: { ...env.DB, batch: async (list: never[]) => { await refreshPoint(env, stowe, base, metas(world), slot); return env.DB.batch(list) } } }
  const result = await refreshPoint(racing, stowe, base, metas(world), slot)
  assert.equal(result.committed, false)
  assert.deepEqual({ ...db.prepare('SELECT (SELECT count(*) FROM forecast_records) records, (SELECT count(*) FROM forecast_snapshots) snapshots, (SELECT version FROM forecast_latest) version').get() }, { records: 10, snapshots: 1, version: 1 })
})

test('a model whose column is missing is marked outside and only ECMWF answers unsuffixed', async t => {
  clock(t)
  const world = upstream(t)
  world.outside = models.map(m => m.id).filter(id => id !== 'ecmwf_ifs025')
  const { db, env } = database()
  const result = await refreshPoint(env, stowe, base, metas(world), null)
  assert.deepEqual([result.committed, result.fetched], [true, 1])
  const state = JSON.parse(db.prepare('SELECT state FROM forecast_latest').get()!.state as string)
  assert.equal(Object.values(state).filter((entry: any) => entry.outside).length, models.length - 1)
  assert.equal((await read(env)).daily.snowfall_sum_ecmwf_ifs025[0], 24)
})

test('the scheduled round only refreshes favorited resorts and stops when rate limited', async t => {
  clock(t)
  const world = upstream(t)
  const { db, env } = database()
  db.prepare('INSERT INTO user_favorites VALUES (?, ?), (?, ?), (?, ?)').run('a', 'stowe', 'b', 'stowe', 'a', 'custom-1')
  const summary = await refreshFavorites(env, start)
  assert.deepEqual([summary.points, summary.committed, summary.skipped], [stowe.points.length, stowe.points.length, 0])
  assert.equal(world.requests.length, stowe.points.length)
  assert.equal(db.prepare('SELECT count(DISTINCT point) n FROM forecast_latest').get()!.n, stowe.points.length)
})
