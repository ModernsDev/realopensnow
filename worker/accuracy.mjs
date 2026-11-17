import { localDate, models } from '../src/weather.ts'
import { waterburyPoint } from '../src/catalog.ts'

const hour = 3_600_000
const day = 24 * hour
export const waterburyStation = 'VT-WS-19'
const units = { cm: 1, in: 2.54 }
const buckets = Array.from({ length: 7 }, (_, i) => i)
const minimumSamples = 10

export function hourlySnow(data) {
  const time = data.hourly.time
  const values = models.map(({ id }) => {
    const key = 'snowfall_' + id
    const column = data.hourly[key]
    return data.hourly_units[key] === 'cm' && Array.isArray(column) && column.length === time.length
      ? column.map(value => Number.isFinite(value) && value >= 0 ? value : null)
      : null
  })
  return { quantity: 'new_snow_depth', unit: 'cm', firstEnd: time[0] * 1000, values }
}

const timezone = 'America/New_York'
const localClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function stationHour(value) {
  const wall = typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:00:00(?:\.0+)?\+00:00$/.test(value) ? value.slice(0, 19) : ''
  const assumed = Date.parse(wall + 'Z')
  if (!Number.isFinite(assumed)) return null
  const possible = [4, 5].map(offset => assumed + offset * hour)
    .filter(candidate => localClock.format(candidate).replace(' ', 'T') === wall)
  return possible.length === 1 ? possible[0] : null
}

function sameStation(row) {
  const { lat, lon } = waterburyPoint.coordinates.value
  return row?.stationNumber === waterburyStation && row.latitude === lat && row.longitude === lon
}

export function observationWindow(row, previous) {
  if (!sameStation(row) || (previous && !sameStation(previous))) return { excluded: 'station' }
  const start = stationHour(previous?.obsDateTime)
  const end = stationHour(row.obsDateTime)
  if (start === null || end === null || end - start !== day) return { excluded: 'window' }
  if (row.units !== 'english' || row.depthOfSnowfallIsTrace !== false ||
      !Number.isFinite(row.depthOfSnowfall) || row.depthOfSnowfall < 0) return { excluded: 'measurement' }
  return {
    start, end, quantity: 'new_snow_depth', unit: 'in', value: row.depthOfSnowfall,
    pointId: waterburyPoint.id, elevation: waterburyPoint.elevation.value,
    ...waterburyPoint.coordinates.value,
  }
}

export function pairedSnow(snapshot, modelIndex, window) {
  const { query, hourly } = snapshot
  if (query.pointId !== window.pointId || query.lat !== window.lat || query.lon !== window.lon ||
      query.elevation !== window.elevation || hourly.quantity !== 'new_snow_depth' ||
      window.quantity !== hourly.quantity || hourly.unit !== 'cm' || !Object.hasOwn(units, window.unit) ||
      !Number.isFinite(window.value) || window.value < 0) return null
  const column = hourly.values[modelIndex]
  const first = (window.start + hour - hourly.firstEnd) / hour
  const count = (window.end - window.start) / hour
  if (!column || !Number.isInteger(first) || !Number.isInteger(count) || first < 0 || count <= 0 || first + count > column.length) return null
  const slice = column.slice(first, first + count)
  if (slice.some(value => !Number.isFinite(value) || value < 0)) return null
  return slice.reduce((sum, value) => sum + value, 0) - window.value * units[window.unit]
}

export function summarizeAccuracy(snapshots, rows, now) {
  const groups = models.map(model => buckets.map(lead => ({ model: model.id, lead, count: 0, bias: 0, mae: 0 })))
  const excluded = { station: 0, window: 0, measurement: 0, forecast: 0 }
  const today = localDate(now, timezone)
  const startDay = new Date(Date.parse(today) - 29 * day).toISOString().slice(0, 10)
  const observed = new Set()
  for (const [index, row] of rows.entries()) {
    const date = row.obsDateTime?.slice(0, 10)
    if (!date || date < startDay || observed.has(date) || date > today) continue
    observed.add(date)
    const window = observationWindow(row, rows[index + 1])
    if (window.excluded) {
      excluded[window.excluded]++
      continue
    }
    if (window.end > now) continue
    const paired = new Set()
    for (const snapshot of snapshots) {
      if (snapshot.fetchedAt >= window.start) continue
      const lead = Math.floor((window.start - snapshot.fetchedAt) / day)
      if (!buckets.includes(lead)) continue
      for (const [m, modelGroups] of groups.entries()) {
        const group = modelGroups[lead]
        if (paired.has(group)) continue
        const error = pairedSnow(snapshot, m, window)
        if (error === null) continue
        paired.add(group)
        group.count++
        group.bias += error
        group.mae += Math.abs(error)
      }
    }
    if (!paired.size) excluded.forecast++
  }
  return {
    groups: groups.flat().map(g => ({
      ...g, bias: g.count ? g.bias / g.count : null, mae: g.count ? g.mae / g.count : null,
      insufficient: g.count < minimumSamples,
    })),
    excluded, minimumSamples,
  }
}
