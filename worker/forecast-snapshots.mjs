import { resorts, waterburyPoint } from '../src/catalog.ts'
import { forecastBatch, forecastSource } from '../src/weather.ts'
import { hourlySnow, summarizeAccuracy } from './accuracy.mjs'
import { stoweDailyReports } from './stowe-observations.mjs'

const noCache = { 'cache-control': 'no-store' }
const pageSize = 10
const sixHours = 6 * 3_600_000
const accuracyPeriod = 38 * 24 * 3_600_000

export async function captureSnapshot(env, pointId) {
  const resort = resorts.find(r => r.points.some(point => point.id === pointId))
  const point = resort.points.find(p => p.id === pointId)
  const { lat, lon } = point.coordinates.value
  const source = forecastSource(lat, lon, point.elevation.value, resort.timezone)
  const requested = new Date().toISOString()
  let batch, hourly
  try {
    const upstream = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(12000) })
    if (upstream.status === 429) return Response.json({ error: 'Open-Meteo 已限流，未保存快照。' }, { status: 429, headers: noCache })
    if (!upstream.ok) throw new Error(`Open-Meteo HTTP ${upstream.status}`)
    const data = await upstream.json()
    batch = {
      ...forecastBatch(data, resort, point, requested, new Date().toISOString()),
      issuedAt: null,
      units: { snowfall_sum: 'cm', temperature_2m_min: '°C', temperature_2m_max: '°C', wind_gusts_10m_max: 'km/h' },
    }
    hourly = pointId === waterburyPoint.id ? hourlySnow(data) : null
  } catch (error) {
    console.warn('forecast_snapshot_upstream', pointId, error.message)
    return Response.json({ error: '上游预报暂不可用，未保存快照。' }, { status: 502, headers: noCache })
  }

  try {
    const { id } = await env.DB.prepare('INSERT INTO forecast_snapshots (point, fetched_at, payload, hourly_snow) VALUES (?, ?, ?, ?) RETURNING id')
      .bind(pointId, Date.parse(batch.fetched), JSON.stringify(batch), hourly ? JSON.stringify(hourly) : null).first()
    return Response.json({ id, data: batch }, { status: 201, headers: noCache })
  } catch (error) {
    console.error('forecast_snapshot_write', pointId, error.message)
    return Response.json({ error: '快照保存失败，请重试。' }, { status: 503, headers: noCache })
  }
}

const timeOrder = 'ORDER BY fetched_at DESC, id DESC'
export async function snapshotHistory(env, point, params) {
  const before = params.get('before')
  if (before !== null && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)) || Number(before) < 1)) {
    return Response.json({ error: '无效的历史游标。' }, { status: 400, headers: noCache })
  }
  try {
    const result = before === null
      ? await env.DB.prepare(`SELECT id, payload FROM forecast_snapshots WHERE point = ? ${timeOrder} LIMIT ?`).bind(point, pageSize + 1).all()
      : await env.DB.prepare(`SELECT id, payload FROM forecast_snapshots WHERE point = ? AND (fetched_at, id) <
          (SELECT fetched_at, id FROM forecast_snapshots WHERE point = ? AND id = ?) ${timeOrder} LIMIT ?`)
        .bind(point, point, Number(before), pageSize + 1).all()
    const rows = result.results.slice(0, pageSize)
    return Response.json({
      snapshots: rows.map(({ id, payload }) => ({ id, data: JSON.parse(payload) })),
      next: result.results.length > pageSize ? rows.at(-1).id : null,
    }, { headers: noCache })
  } catch (error) {
    console.error('forecast_snapshot_read', point, error.message)
    return Response.json({ error: '暂时无法读取历史快照。' }, { status: 503, headers: noCache })
  }
}

export async function stationAccuracy(env, point) {
  if (point !== waterburyPoint.id) return Response.json({ error: '此查询点没有同址直接新雪观测。' }, { status: 404, headers: noCache })
  const now = Date.now()
  try {
    const [{ results }, reports] = await Promise.all([
      env.DB.prepare(`WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY fetched_at / ? ${timeOrder}) AS rank
        FROM forecast_snapshots WHERE point = ? AND fetched_at >= ? AND hourly_snow IS NOT NULL
      ) SELECT fetched_at, payload, hourly_snow
        FROM ranked JOIN forecast_snapshots USING (id) WHERE rank = 1
        ORDER BY fetched_at DESC, id DESC`).bind(sixHours, point, now - accuracyPeriod).all(),
      stoweDailyReports(35),
    ])
    const snapshots = results.map(row => ({
      fetchedAt: row.fetched_at, query: JSON.parse(row.payload).query, hourly: JSON.parse(row.hourly_snow),
    }))
    return Response.json(summarizeAccuracy(snapshots, reports, now), { headers: noCache })
  } catch (error) {
    console.error('forecast_accuracy_read', point, error.message)
    return Response.json({ error: '暂时无法核对历史快照与 CoCoRaHS 观测。' }, { status: 503, headers: noCache })
  }
}
