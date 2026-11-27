import { t } from './i18n.ts'
import { mapped, type Coordinates, type Resort } from './catalog.ts'

export const customLocationsKey = 'snow-custom-locations'
export type CustomLocation = { id: string; name: string; lat: number; lon: number; elevation: number; timezone: string; createdOn: string }
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>

function angle(text: string) {
  const match = /^([NSEW])?\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:°(?:\s*(\d+(?:\.\d+)?)\s*['′](?:\s*(\d+(?:\.\d+)?)\s*["″])?)?)?\s*([NSEW])?$/i.exec(text)
  if (!match) return null
  const [, prefix, degrees, minutes, seconds, suffix] = match
  if ((prefix && suffix) || (minutes && degrees.includes('.')) || (seconds && minutes.includes('.'))) return null
  const m = Number(minutes ?? 0), s = Number(seconds ?? 0)
  const direction = (prefix || suffix)?.toUpperCase()
  const negative = degrees.startsWith('-')
  if (m >= 60 || s >= 60 || (negative && (direction === 'N' || direction === 'E'))) return null
  const axis = direction ? ('NS'.includes(direction) ? 'lat' : 'lon') : null
  const sign = negative || direction === 'S' || direction === 'W' ? -1 : 1
  return { axis, value: sign * (Math.abs(Number(degrees)) + m / 60 + s / 3600) }
}

function pair(first: string, second: string): Coordinates | null {
  const a = angle(first), b = angle(second)
  if (!a || !b || (a.axis && a.axis === b.axis)) return null
  const [lat, lon] = a.axis === 'lon' || b.axis === 'lat' ? [b.value, a.value] : [a.value, b.value]
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

export function parseCoordinates(text: string): Coordinates | null {
  const parts = text.trim().split(/\s*[,，]\s*/)
  if (parts.length === 2) return pair(parts[0], parts[1])
  if (parts.length !== 1) return null
  const input = parts[0]
  for (const gap of input.matchAll(/\s+/g)) {
    const coordinates = pair(input.slice(0, gap.index), input.slice(gap.index + gap[0].length))
    if (coordinates) return coordinates
  }
  return null
}

function validTimezone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export async function resolveLocation(c: Coordinates, signal?: AbortSignal): Promise<{ elevation: number; timezone: string }> {
  const params = new URLSearchParams({ latitude: String(c.lat), longitude: String(c.lon), timezone: 'auto', forecast_days: '1', daily: 'snowfall_sum' })
  const timeout = AbortSignal.timeout(20000)
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  if (response.status === 429) throw new Error(t('天气服务已限流（429），请稍后重试。', 'The weather service is rate limiting requests (429). Please try again later.'))
  if (!response.ok) throw new Error(t(`天气服务请求失败（${response.status}）`, `Weather service request failed (${response.status})`))
  let data
  try {
    data = await response.json()
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new Error(t('天气服务返回的地点数据无效', 'The weather service returned invalid location data'))
  }
  if (!Number.isFinite(data?.elevation) || data.elevation < -500 || data.elevation > 9000 || !validTimezone(data.timezone)) throw new Error(t('天气服务返回的海拔或时区无效', 'The weather service returned an invalid elevation or time zone'))
  return { elevation: Math.round(data.elevation), timezone: data.timezone }
}

export function createLocation(name: string, c: Coordinates, elevation: number, timezone: string): CustomLocation {
  return { id: 'custom-' + crypto.randomUUID(), name: name.trim(), lat: Number(c.lat.toFixed(5)), lon: Number(c.lon.toFixed(5)), elevation, timezone, createdOn: new Date().toISOString().slice(0, 10) }
}

export function customResort(l: CustomLocation): Resort {
  const coordinates = mapped({ lat: l.lat, lon: l.lon }, 'userInput')
  return {
    id: l.id, name: l.name, custom: true, country: '', region: t('自定义地点', 'Custom location'), aliases: [],
    identitySources: ['userInput'], areas: [{ id: l.id, name: l.name }], areaNote: '', coordinates,
    timezone: l.timezone, timezoneSources: ['openmeteoGeo'], terrain: '', updatedOn: l.createdOn,
    points: [{ id: l.id + '-point', kind: 'custom', name: t('自定义坐标', 'Custom coordinates'), areaId: l.id, coordinates,
      elevation: mapped(l.elevation, 'userInput', 'openmeteoGeo'), note: '坐标由用户提供，海拔由用户填写或取自 Open-Meteo 地形数据。' }],
  }
}

export function validLocation(l: CustomLocation) {
  return l && typeof l.id === 'string' && /^custom-.+/.test(l.id) && typeof l.name === 'string' && l.name.trim() &&
    Number.isFinite(l.lat) && Math.abs(l.lat) <= 90 && Number.isFinite(l.lon) && Math.abs(l.lon) <= 180 &&
    Number.isFinite(l.elevation) && l.elevation >= -500 && l.elevation <= 9000 && validTimezone(l.timezone) &&
    typeof l.createdOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.createdOn) && Number.isFinite(Date.parse(l.createdOn)) &&
    new Date(l.createdOn).toISOString().slice(0, 10) === l.createdOn
}

export function readCustomLocations(storage: StorageAccess): { locations: CustomLocation[]; error: string | null } {
  try {
    const raw = storage().getItem(customLocationsKey)
    if (raw === null) return { locations: [], error: null }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('记录应为数组')
    const ids = new Set<string>()
    const locations = parsed.filter(l => validLocation(l) && !ids.has(l.id) && ids.add(l.id))
    return { locations, error: locations.length === parsed.length ? null : t('本机自定义地点含无效或重复记录，已整理。请保存以更新本机记录。', 'Invalid or duplicate custom locations on this device were cleaned up. Save to update the stored list.') }
  } catch {
    return { locations: [], error: t('无法读取本机自定义地点（存储不可用或记录损坏）。', 'Could not read custom locations on this device (storage unavailable or data corrupted).') }
  }
}

export function saveCustomLocations(locations: CustomLocation[], storage: StorageAccess): string | null {
  try {
    storage().setItem(customLocationsKey, JSON.stringify(locations))
    return null
  } catch {
    return t('无法保存本机自定义地点；当前更改仅在本页有效，刷新后可能丢失。请允许网站存储后重试保存。', 'Could not save custom locations on this device; changes apply to this page only and may be lost on reload. Allow site storage and retry.')
  }
}
