import { queryBlockReason, resorts, waterburyPoint } from '../src/catalog.ts'
import { forecastBatch, localDate, models, pageForecast } from '../src/weather.ts'
import { hourlySnow } from './accuracy.mjs'
import { snapshotUnits } from './forecast-snapshots.mjs'

const hour = 3600
const variables = ['snowfall', 'temperature_2m', 'wind_gusts_10m', 'rain', 'freezing_level_height']
export const modelMembers = {
  ecmwf_ifs025: ['ecmwf_ifs025'],
  gfs_seamless: ['ncep_gfs025', 'ncep_hrrr_conus'],
  icon_seamless: ['dwd_icon', 'dwd_icon_eu', 'dwd_icon_d2'],
  ecmwf_aifs025_single: ['ecmwf_aifs025_single'],
  ncep_aigfs025: ['ncep_aigfs025'],
  ncep_nbm_conus: ['ncep_nbm_conus'],
  gfs_hrrr: ['ncep_hrrr_conus'],
  gem_global: ['cmc_gem_gdps_15km'],
  gem_regional: ['cmc_gem_rdps_10km'],
  gem_hrdps_continental: ['cmc_gem_hrdps'],
  icon_eu: ['dwd_icon_eu'],
  icon_d2: ['dwd_icon_d2'],
}
const metaPaths = [...new Set(Object.values(modelMembers).flat())]
const retryDelay = 2 * 3_600_000
const roundBudget = 10 * 60_000
const retention = 40 * 86_400_000
const noCache = { 'cache-control': 'no-store' }

function offset(time, timezone) {
  const name = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(time).find(part => part.type === 'timeZoneName').value
  const match = /([+-])(\d\d):(\d\d)(?::(\d\d))?/.exec(name)
  return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] ?? 0)) * 1000 : 0
}

export function forecastWindow(now, timezone, past = 8, days = 16) {
  const today = Date.parse(`${localDate(now, timezone)}T12:00:00Z`)
  const midnight = shift => {
    const wall = Date.parse(`${new Date(today + shift * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`)
    return Math.floor((wall - offset(wall - offset(wall, timezone), timezone)) / 3_600_000) * hour
  }
  return { start: midnight(-past), end: midnight(days) - hour }
}

const pointConfig = (resort, point) => JSON.stringify([point.coordinates.value, point.elevation.value, resort.timezone, modelMembers])
const stamp = seconds => new Date(seconds * 1000).toISOString().slice(0, 16)

async function fetchSlice(point, model, start, end) {
  const { lat, lon } = point.coordinates.value
  const query = new URLSearchParams({ latitude: String(lat), longitude: String(lon), elevation: String(point.elevation.value), timezone: 'GMT', models: model, hourly: variables.join(','), timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm', start_hour: stamp(start), end_hour: stamp(end) })
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { redirect: 'manual', signal: AbortSignal.timeout(20000) })
    if (response.status === 429) return { kind: 'limited' }
    const data = await response.json()
    if (data.error && data.reason === 'No data is available for this location') return { kind: 'outside' }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const time = data.hourly?.time
    if (!Array.isArray(time) || time.length !== (end - start) / hour + 1 || time.some((value, i) => value !== start + i * hour)) throw new Error('unexpected time axis')
    if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude) || data.elevation !== point.elevation.value) throw new Error('unexpected grid')
    return { kind: 'ok', data }
  } catch (error) {
    console.warn('forecast_store_upstream', point.id, model, error.message)
    return { kind: 'failed' }
  }
}

export function responseShape(series, end, resort, point) {
  const { latitude, longitude } = series.models.ecmwf_ifs025.grid
  const hourly = { time: Array.from({ length: (end - series.start) / hour + 1 }, (_, i) => series.start + i * hour) }
  const units = { time: 'unixtime' }
  for (const [model, entry] of Object.entries(series.models)) {
    for (const variable of variables) {
      if (entry.hourly[variable]) hourly[`${variable}_${model}`] = entry.hourly[variable]
      if (entry.units[variable] !== undefined) units[`${variable}_${model}`] = entry.units[variable]
    }
  }
  return { latitude, longitude, elevation: point.elevation.value, timezone: resort.timezone, hourly_units: units, hourly }
}

function sliceShape(data, start, end) {
  const from = data.hourly.time.indexOf(start)
  const until = data.hourly.time.indexOf(end) + 1
  return { ...data, hourly: Object.fromEntries(Object.entries(data.hourly).map(([key, values]) => [key, values.slice(from, until)])) }
}

export async function refreshPoint(env, resort, point, metas, slot) {
  const now = Date.now()
  const row = await env.DB.prepare('SELECT version, config, state, series, built_date, payload IS NOT NULL AS built FROM forecast_latest WHERE point = ?').bind(point.id).first()
  const version = row?.version ?? 0
  const config = pointConfig(resort, point)
  const fresh = row?.config !== config
  const state = fresh || !row.state ? {} : JSON.parse(row.state)
  const previous = fresh || !row.series ? { start: 0, models: {} } : JSON.parse(row.series)
  const { start, end } = forecastWindow(now, resort.timezone)
  const count = (end - start) / hour + 1
  const moved = (start - previous.start) / hour
  const series = { start, models: Object.fromEntries(Object.entries(previous.models).map(([model, entry]) => [model, {
    ...entry, hourly: Object.fromEntries(variables.map(variable => [variable, entry.hourly[variable] && Array.from({ length: count }, (_, i) => entry.hourly[variable][i + moved] ?? null)])),
  }])) }
  const records = []
  let limited = false, confirmed = true, merged = false, failed = 0
  for (const { id } of models) {
    const entry = state[id] ??= { seen: {} }
    if (entry.outside) continue
    const members = modelMembers[id]
    if (limited || members.some(member => !metas[member])) { confirmed = false; continue }
    const updated = members.filter(member => metas[member].available * 1000 <= now && !(entry.seen[member] >= metas[member].init))
    const candidates = updated.map(member => entry.seen[member] ?? start)
    if (!(entry.covered_to >= end)) candidates.push(entry.covered_to === undefined ? start : entry.covered_to + hour)
    if (!candidates.length) {
      entry.verified_at = now
      delete entry.pending
      continue
    }
    entry.pending = true
    if (entry.retry_at > now) { confirmed = false; continue }
    const from = Math.max(start, Math.floor(Math.min(...candidates) / hour) * hour)
    const result = await fetchSlice(point, id, from, end)
    if (result.kind === 'outside') {
      state[id] = { outside: true }
      delete series.models[id]
      merged = true
    } else if (result.kind === 'ok') {
      const { data } = result
      const target = series.models[id] ??= { hourly: Object.fromEntries(variables.map(variable => [variable, Array(count).fill(null)])) }
      const hourly = {}
      for (const variable of variables) {
        const column = data.hourly[variable]
        if (!Array.isArray(column) || column.length !== data.hourly.time.length) { target.hourly[variable] = null; continue }
        hourly[variable] = column
        target.hourly[variable] ??= Array(count).fill(null)
        column.forEach((value, i) => { target.hourly[variable][(from - start) / hour + i] = value })
      }
      target.units = data.hourly_units
      target.grid = { latitude: data.latitude, longitude: data.longitude, elevation: data.elevation }
      const fetchedAt = Date.now()
      for (const member of updated) entry.seen[member] = metas[member].init
      Object.assign(entry, { covered_to: end, fetched_at: fetchedAt, verified_at: fetchedAt })
      delete entry.pending
      delete entry.retry_at
      records.push([point.id, id, fetchedAt, from, end, JSON.stringify(Object.fromEntries(members.map(member => [member, metas[member]]))), JSON.stringify(hourly), JSON.stringify(target.units), JSON.stringify(target.grid)])
      merged = true
    } else {
      confirmed = false
      failed++
      if (result.kind === 'limited') limited = true
      else entry.retry_at = now + retryDelay
    }
  }

  const today = localDate(now, resort.timezone)
  const complete = models.every(({ id }) => state[id].outside || state[id].covered_to === end)
  let payload, snapshot
  if (series.models.ecmwf_ifs025) {
    const data = responseShape(series, end, resort, point)
    const requested = new Date(now).toISOString()
    if (merged || !row?.built || row.built_date !== today) payload = pageForecast(data, resort, point, requested, requested)
    if (slot !== null && confirmed && complete) {
      const recent = forecastWindow(now, resort.timezone, 1, 8)
      const sliced = sliceShape(data, recent.start, recent.end)
      const fetched = new Date().toISOString()
      const batch = { ...forecastBatch(sliced, resort, point, requested, fetched), issuedAt: null, units: snapshotUnits }
      snapshot = [point.id, Date.parse(fetched), JSON.stringify(batch), point.id === waterburyPoint.id ? JSON.stringify(hourlySnow(sliced)) : null, slot]
    }
  }

  const guard = '(SELECT version FROM forecast_latest WHERE point = ?) = ?'
  const built = payload ? [today, JSON.stringify(payload)] : fresh ? [null, null] : null
  const statements = [
    env.DB.prepare('INSERT INTO forecast_latest (point, version) VALUES (?, 0) ON CONFLICT (point) DO NOTHING').bind(point.id),
    ...records.map(record => env.DB.prepare(`INSERT INTO forecast_records (point, model, fetched_at, first_hour, last_hour, members, hourly, units, grid) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`).bind(...record, point.id, version)),
    ...(snapshot ? [env.DB.prepare(`INSERT INTO forecast_snapshots (point, fetched_at, payload, hourly_snow, cron_slot) SELECT ?, ?, ?, ?, ? WHERE ${guard} ON CONFLICT (point, cron_slot) DO NOTHING`).bind(...snapshot, point.id, version)] : []),
    env.DB.prepare(`UPDATE forecast_latest SET version = version + 1, config = ?, state = ?, series = ?, updated_at = ?${built ? ', built_date = ?, payload = ?' : ''} WHERE point = ? AND version = ?`)
      .bind(config, JSON.stringify(state), JSON.stringify(series), Date.now(), ...(built ?? []), point.id, version),
  ]
  const results = await env.DB.batch(statements)
  return { committed: results.at(-1).meta.changes === 1, fetched: records.length, failed, limited }
}

async function readMetas() {
  const entries = await Promise.all(metaPaths.map(async path => {
    try {
      const response = await fetch(`https://api.open-meteo.com/data/${path}/static/meta.json`, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const { last_run_initialisation_time: init, last_run_availability_time: available } = await response.json()
      if (!Number.isSafeInteger(init) || !Number.isSafeInteger(available)) throw new Error('unexpected metadata')
      return [path, { init, available }]
    } catch (error) {
      console.warn('forecast_store_meta', path, error.message)
      return null
    }
  }))
  return Object.fromEntries(entries.filter(Boolean))
}

export async function refreshFavorites(env, scheduledTime) {
  const started = Date.now()
  const [favorites, latest] = await env.DB.batch([
    env.DB.prepare('SELECT DISTINCT resort_id FROM user_favorites'),
    env.DB.prepare('SELECT point, updated_at FROM forecast_latest'),
  ])
  const ids = new Set(favorites.results.map(row => row.resort_id))
  const updated = new Map(latest.results.map(row => [row.point, row.updated_at]))
  const queue = resorts.filter(resort => ids.has(resort.id))
    .flatMap(resort => resort.points.filter(point => !queryBlockReason(resort, point)).map(point => [resort, point]))
    .sort((a, b) => (updated.get(a[1].id) ?? 0) - (updated.get(b[1].id) ?? 0))
  const metas = queue.length ? await readMetas() : {}
  const slot = new Date(scheduledTime).getUTCHours() % 3 === 0 ? Math.floor(scheduledTime / 10_800_000) * 10_800_000 : null
  const summary = { event: 'favorite_refresh', resorts: ids.size, points: queue.length, metas: Object.keys(metas).length, committed: 0, conflicts: 0, fetched: 0, failed: 0, errors: 0, limited: false }
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const result = await refreshPoint(env, ...job, metas, slot)
        summary[result.committed ? 'committed' : 'conflicts']++
        summary.fetched += result.fetched
        summary.failed += result.failed
        if (result.limited) summary.limited = true
      } catch (error) {
        summary.errors++
        console.error('forecast_store_point', job[1].id, error.message)
      }
      if (summary.limited || Date.now() - started > roundBudget) break
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  summary.skipped = queue.length
  const cutoff = Date.now() - retention
  await env.DB.prepare('DELETE FROM forecast_records WHERE rowid IN (SELECT rowid FROM forecast_records WHERE fetched_at < ? AND last_hour < ? LIMIT 1000)').bind(cutoff, Math.floor(Date.now() / 1000) - 10 * 86400).run()
  console[summary.failed || summary.errors || summary.limited ? 'warn' : 'log'](JSON.stringify(summary))
  return summary
}

export async function latestForecast(env, pointId) {
  const missing = () => new Response(null, { status: 404, headers: noCache })
  const resort = resorts.find(r => r.points.some(point => point.id === pointId))
  const point = resort.points.find(p => p.id === pointId)
  const row = await env.DB.prepare('SELECT config, state, built_date, payload FROM forecast_latest WHERE point = ?').bind(pointId).first()
  const now = Date.now()
  if (!row?.payload || row.config !== pointConfig(resort, point) || row.built_date !== localDate(now, resort.timezone)) return missing()
  const state = JSON.parse(row.state)
  const { end } = forecastWindow(now, resort.timezone)
  const covered = models.map(({ id }) => state[id]).filter(entry => !entry?.outside)
  if (!covered.every(entry => entry?.fetched_at && entry.covered_to === end && !entry.pending)) return missing()
  const payload = JSON.parse(row.payload)
  payload.fetched = payload.extended.fetched = new Date(Math.min(...covered.map(entry => entry.verified_at))).toISOString()
  return Response.json(payload, { headers: noCache })
}
