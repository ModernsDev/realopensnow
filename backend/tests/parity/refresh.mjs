import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { writeFixture } from './fixture.mjs'
import { DatabaseSync } from 'node:sqlite'
import { mock } from 'node:test'
import { resorts } from '../../../src/catalog.ts'
import { models } from '../../../src/weather.ts'
import { latestForecast, refreshPoint } from '../../../worker/forecast-store.mjs'

const fixtures = new URL('../fixtures/', import.meta.url)
const read = name => JSON.parse(readFileSync(new URL('recorded/' + name, fixtures), 'utf8'))
const hour = 3_600_000
const index = read('index.json')
const start = index.recordedAt
const waterbury = index.slice[1]
const variables = ['snowfall', 'temperature_2m', 'wind_gusts_10m', 'rain', 'freezing_level_height']

function dbAdapter(db) {
  for (const file of ['0002_forecast_snapshots', '0005_forecast_store']) {
    db.exec(readFileSync(new URL('../../../drizzle/' + file + '.sql', import.meta.url), 'utf8'))
  }
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    first: () => db.prepare(sql).get(...values) ?? null,
    execute: () => ({ meta: { changes: db.prepare(sql).run(...values).changes } }),
  })
  return { DB: { prepare: statement, batch: list => {
    db.exec('BEGIN')
    try {
      const results = list.map(s => s.execute())
      db.exec('COMMIT')
      return results
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } } }
}

function withoutReport(payload) {
  if (payload) delete payload.report
  return payload
}

function sample(recorded, params, step) {
  const zone = params.timezone
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const seconds = label => {
    const wall = Date.parse(label + 'Z')
    for (let i = -14; i <= 14; i++) {
      const ms = wall + i * hour
      if (formatter.format(ms).replace(' ', 'T') === label) return ms / 1000
    }
    throw Error('unmatched request hour ' + label)
  }
  const from = seconds(params.start_hour), end = seconds(params.end_hour)
  const time = Array.from({length:(end - from) / 3600 + 1}, (_,i) => from + i * 3600)
  const source = recorded.hourly
  const covered = params.models.split(',').filter(id =>
    !step.outside?.includes(id) && variables.some(v => v + '_' + id in source))
  const hourly = {time}, units = {time:'unixtime'}
  for (const id of covered) {
    for (const variable of variables) {
      const key = variable + '_' + id
      if (!(key in source) || key === step.drop) continue
      const output = covered.length === 1 ? variable : key
      hourly[output] = time.map(t => {
        const i = (t - (step.shift ?? 0) - source.time[0]) / 3600
        if (step.constant != null) return step.constant
        assert.ok(Number.isInteger(i) && i >= 0 && i < source.time.length, key + ' outside recording at ' + t)
        const n = source[key][i]
        return n !== null && variable === 'snowfall' ? n + (step.addSnow ?? 0) : n
      })
      if (step.short === key) hourly[output].pop()
      if (step.noUnit !== key) units[output] = recorded.hourly_units[key]
    }
  }
  const data = {latitude:recorded.latitude,longitude:recorded.longitude,elevation:Number(params.elevation),timezone:zone,hourly_units:units,hourly}
  if (step.invalid === 'elevation') data.elevation++
  if (step.invalid === 'coordinate') data.longitude = null
  if (step.invalid === 'axis') data.hourly.time[0]++
  return {data, from, end}
}

async function runScenario(name, recording, steps, pointId = recording.point, overrides = {}) {
  const resort = resorts.find(r => r.points.some(p => p.id === pointId))
  assert.ok(!['America/Winnipeg', 'America/Edmonton', 'America/Vancouver'].includes(resort.timezone),
    'refresh parity excludes time zones with known tzdb differences')
  const point = resort.points.find(p => p.id === pointId)
  const recorded = read(recording.file)
  const metas = Object.fromEntries(Object.entries(read('meta.json')).map(([k,v]) =>
    [k, {init:v.last_run_initialisation_time,available:v.last_run_availability_time}]))
  Object.assign(metas,overrides)
  const db = new DatabaseSync(':memory:')
  const env = dbAdapter(db)
  const rounds = []
  const values = [], lookup = new Map()
  const ref = value => {
    if (value == null) return null
    const key = JSON.stringify(value)
    if (!lookup.has(key)) {
      lookup.set(key, values.length)
      values.push(value)
    }
    return lookup.get(key)
  }
  let step, request, response
  const latest = async () => {
    const r = await latestForecast(env,pointId)
    if (r.status === 404) return null
    assert.equal(r.status,200)
    return withoutReport(await r.json())
  }
  try {
    mock.timers.enable({apis:['Date'], now:steps[0].now})
    mock.method(globalThis,'fetch',async input => {
      assert.equal(request,null,'multiple upstream calls')
      const url = new URL(input)
      assert.equal(url.origin + url.pathname,'https://api.open-meteo.com/v1/forecast')
      const params = Object.fromEntries(url.searchParams)
      const {data,from,end} = sample(recorded,params,step)
      request = {ids:params.models.split(','),from,end,query_params:params}
      response = step.http ? (step.http === 429 ? 'limited' : 'failed') : ref(data)
      return step.http ? new Response(null,{status:step.http}) : Response.json(data)
    })
    for (step of steps) {
      mock.timers.setTime(step.now)
      if (step.staleConfig) db.prepare("UPDATE forecast_latest SET config = 'stale' WHERE point = ?").run(pointId)
      if (step.unbuilt) db.prepare('UPDATE forecast_latest SET payload = NULL WHERE point = ?').run(pointId)
      if (step.staleDate) db.prepare("UPDATE forecast_latest SET built_date = '2026-01-01' WHERE point = ?").run(pointId)
      for (const member of step.advance ?? []) {
        metas[member] = {init:metas[member].init + 21600, available:Math.floor((step.available ?? step.now) / 1000)}
      }
      const active = Object.fromEntries(Object.entries(metas).filter(([m]) => m !== step.missing))
      const before = ref(await latest())
      request = null
      response = null
      const prev = db.prepare('SELECT MAX(id) AS id FROM forecast_snapshots').get().id ?? 0
      const existing = db.prepare('SELECT payload FROM forecast_latest WHERE point = ?').get(pointId)
      const slot = step.slot ? Math.floor(step.now / (3 * hour)) * 3 * hour : null
      const result = await refreshPoint(env,resort,point,active,slot)
      const row = db.prepare('SELECT version, config, state, series, built_date, payload FROM forecast_latest WHERE point = ?').get(pointId)
      const saved = db.prepare('SELECT fetched_at, payload, hourly_snow, cron_slot FROM forecast_snapshots WHERE id > ?').get(prev)
      const snapshot = saved ? {fetched_at_ms:saved.fetched_at,payload:JSON.parse(saved.payload),hourly_snow:JSON.parse(saved.hourly_snow)} : null
      if (saved) assert.equal(saved.cron_slot,slot)
      const write = row.payload !== existing?.payload && row.payload ? 'set' : step.staleConfig || !existing ? 'clear' : 'keep'
      rounds.push({
        name:step.name, now:step.now,slot,staleConfig:!!step.staleConfig,unbuilt:!!step.unbuilt,staleDate:!!step.staleDate,metas:structuredClone(active),
        request,response,before,result,version:row.version,config:row.config,state:JSON.parse(row.state),
        series:ref(JSON.parse(row.series)),built_date:row.built_date,payload:ref(withoutReport(JSON.parse(row.payload))),
        write,snapshot,latest:ref(await latest()),
      })
    }
  } finally {
    mock.reset()
    db.close()
  }
  writeFixture(new URL('expected/refresh-' + name + '.json',fixtures), {point:pointId,rounds,values})
}

export async function generateRefresh() {
  mkdirSync(new URL('expected/',fixtures),{recursive:true})
  const steps = [
    {name:'cold',now:start},
    {name:'verified without request, three-hour slot',now:start+hour,slot:true},
    {name:'partial shared member, a missing column and a short column',now:start+hour+1,advance:['ncep_hrrr_conus'],addSnow:1,drop:'rain_gfs_hrrr',short:'wind_gusts_10m_gfs_seamless',noUnit:'snowfall_gfs_hrrr'},
    {name:'upstream HTTP 500',now:start+2*hour,advance:['ncep_nbm_conus'],http:500,slot:true},
    {name:'retry suppressed',now:start+3*hour},
    {name:'retry at two hours',now:start+4*hour,slot:true},
    {name:'model becomes outside, ECMWF is only fallback',now:start+5*hour,advance:['dwd_icon'],outside:['icon_seamless']},
    {name:'429 no retry delay',now:start+6*hour,advance:['ecmwf_ifs025'],http:429,slot:true},
    {name:'single unsuffixed model',now:start+6*hour+1},
    {name:'missing metadata blocks slot',now:start+7*hour,missing:'ncep_nbm_conus',slot:true},
    {name:'new member run before availability',now:start+7*hour+1,advance:['ncep_gfs025'],available:start+100*hour},
    {name:'unbuilt row rebuilds without merge',now:start+7*hour+2,unbuilt:true},
    {name:'date mismatch rebuilds without merge',now:start+7*hour+3,staleDate:true},
    {name:'local midnight shifts series and fetches tail',now:start+24*hour,shift:86400,slot:true},
    {name:'config change failed request clears payload',now:start+24*hour+1,shift:86400,staleConfig:true,invalid:'axis'},
    {name:'config change cold rebuild',now:start+26*hour+1,shift:86400},
  ]
  await runScenario('waterbury',waterbury,steps)
  await runScenario('alta',index.slice[0],[{name:'recorded cold',now:start,slot:true}])
  await runScenario('niseko',index.slice[2],[{name:'recorded cold',now:start}])
  const morning = Date.parse('2026-11-28T12:00:00Z')
  await runScenario('marble',waterbury,[{name:'half-hour query, local payload',now:morning,constant:1}], 'ca-nl-marble-mountain-base')
  const first = Date.parse('2026-11-28T00:20:00Z')
  const firstRun = Date.parse('2026-11-27T18:00:00Z')/1000
  const metas = Object.fromEntries(Object.keys(read('meta.json')).map(k=>[k,{init:firstRun,available:first/1000-3600}]))
  await runScenario('stowe-base',waterbury,[
    {name:'ten covered models',now:first,constant:1,slot:true},
    {name:'all runs verified',now:first+hour,constant:1},
    {name:'shared HRRR member only',now:first+hour+1,advance:['ncep_hrrr_conus'],constant:2},
    {name:'new local day',now:first+24*hour,constant:1},
  ],'stowe-base',metas)
  await runScenario('invalid',waterbury,[
    {name:'bad coordinates',now:start,invalid:'coordinate',slot:true},
    {name:'bad elevation',now:start+2*hour,invalid:'elevation',slot:true},
    {name:'only ECMWF in bounds',now:start+4*hour,outside:models.filter(m=>m.id!=='ecmwf_ifs025').map(m=>m.id),slot:true},
  ])
  const fallback = Date.parse('2026-11-01T09:20:00Z')
  const fallMetas = Object.fromEntries(Object.keys(metas).map(k=>[k,{
    init:Date.parse('2026-11-01T06:00:00Z')/1000,available:(fallback-1000)/1000,
  }]))
  await runScenario('fall-back',waterbury,[
    {name:'autumn 25-hour day',now:fallback,constant:1},
    {name:'ambiguous start steps back past both 01:00 hours',now:fallback+hour,constant:2,advance:['ncep_hrrr_conus']},
  ],'stowe-base',fallMetas)
}
