import { resorts, sources } from './catalog.ts'

const hour = 60 * 60 * 1000
const stationOffset = '-08:00'
const japanOffset = '+09:00'
const awdb = 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data'
const amedas = 'https://www.jma.go.jp/bosai/amedas/data'

type Station = {
  name: string
  elevation: number | null
  source: string
  url: string
  terms: string
  triplet?: string
  provider: 'snotel' | 'amedas' | 'cocorahs'
  maxAgeHours: number
}

function snotel(resortId: string, stationId: string, name: string, stationNumber: number, sourceId: string): Station {
  const point = resorts.find(resort => resort.id === resortId)!.points.find(point => point.id === stationId)!
  return { name, elevation: point.elevation.value, provider: 'snotel', maxAgeHours: 3, source: '美国农业部自然资源保护局（USDA NRCS） · AWDB', url: sources[sourceId].url, terms: sources[sourceId].licenseUrl!, triplet: `${stationNumber}:UT:SNTL` }
}

export const observationStations: Record<string, Station | undefined> = {
  alta: snotel('alta', 'alta-atwater-1308', 'Atwater SNOTEL 1308', 1308, 'atwater'),
  snowbird: snotel('snowbird', 'snowbird-snotel-766', 'Snowbird SNOTEL 766', 766, 'snowbirdStation'),
  niseko: {
    provider: 'amedas',
    maxAgeHours: 3,
    name: '倶知安（Kutchan）AMeDAS 16217',
    elevation: 176,
    source: '日本气象厅（JMA） · AMeDAS',
    url: 'https://www.jma.go.jp/bosai/amedas/#area_type=offices&area_code=016000&amdno=16217&format=table&elems=snow',
    terms: 'https://www.jma.go.jp/jma/kishou/info/coment.html',
  },
  stowe: {
    provider: 'cocorahs',
    maxAgeHours: 30,
    name: 'Waterbury 3.0 NW · CoCoRaHS VT-WS-19',
    elevation: Math.round(458 * 0.3048),
    source: 'CoCoRaHS · 每日观测',
    url: 'https://dex.cocorahs.org/stations/VT-WS-19/obs-tables',
    terms: 'https://www.cocorahs.org/content.aspx?page=datausagepolicy',
  },
}

type Reading = { cm: number; observedAt: number; trace?: true }
type Readings = { newSnow: Reading | null; depth: Reading | null }
type AwdbSeries = {
  stationElement: { elementCode: string; ordinal: number; durationName: string; storedUnitCode: string; derivedData: boolean }
  values: { date: string; value: number | null; qcFlag: string }[]
}

export const expiredObservation = (reading: Reading, now: number, maxAgeHours = 3) => now - reading.observedAt >= maxAgeHours * hour

function recentIndex(times: number[], now: number) {
  return times.reduce((latest, time, index) => time <= now && (latest === -1 || time > times[latest]) ? index : latest, -1)
}

function reading(value: unknown, observedAt: number, cmPerUnit: number): Reading | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { cm: value * cmPerUnit, observedAt } : null
}

export function awdbReadings(payload: unknown, triplet: string, now: number): Readings {
  if (!Array.isArray(payload)) throw new Error('AWDB 返回格式异常')
  const station = (payload as { stationTriplet: string; data: AwdbSeries[] }[]).find(item => item?.stationTriplet === triplet)
  const data = station?.data.find(({ stationElement: e }) =>
    e.elementCode === 'SNWD' && e.ordinal === 1 && e.durationName === 'HOURLY' && e.storedUnitCode === 'in' && !e.derivedData)
  const values = data?.values ?? []
  const times = values.map(({ date }) => Date.parse(date.replace(' ', 'T') + ':00' + stationOffset))
  const index = recentIndex(times, now)
  const latest = values[index]
  return { newSnow: null, depth: latest?.qcFlag === 'V' ? reading(latest.value, times[index], 2.54) : null }
}

export function amedasReadings(payload: unknown, now: number): Readings {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('AMeDAS 返回格式异常')
  const rows = Object.entries(payload).filter(([key]) => /^\d{10}0000$/.test(key))
  const times = rows.map(([key]) => Date.parse(key.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)0000$/, '$1-$2-$3T$4:00:00') + japanOffset))
  const index = recentIndex(times, now)
  const latest = rows[index]?.[1]
  return {
    newSnow: latest?.snow24h?.[1] === 0 ? reading(latest.snow24h[0], times[index], 1) : null,
    depth: latest?.snow?.[1] === 0 ? reading(latest.snow[0], times[index], 1) : null,
  }
}

type DailyReading = {
  obsDateTime: string
  depthOfSnowfall: number | null
  depthOfSnowfallIsTrace: boolean
  depthOfSnowOnGround: number | null
  depthOfSnowOnGroundIsTrace: boolean
}

const vermontOffset = new Intl.DateTimeFormat('en', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })

export function cocorahsReadings(payload: DailyReading | null, now: number): Readings {
  if (payload === null) return { newSnow: null, depth: null }

  const wallTime = payload.obsDateTime?.slice(0, 19)
  const tentative = Date.parse(wallTime + 'Z')
  if (!Number.isFinite(tentative)) throw new Error('CoCoRaHS 时间格式异常')
  const offsetAt = (time: number) => vermontOffset.formatToParts(time).find(part => part.type === 'timeZoneName')!.value.slice(3)
  const observedAt = Date.parse(wallTime + offsetAt(Date.parse(wallTime + offsetAt(tentative))))
  if (observedAt > now) return { newSnow: null, depth: null }

  const depthReading = (value: number | null, trace: boolean) =>
    trace ? { cm: 0, trace: true as const, observedAt } : reading(value, observedAt, 2.54)
  return {
    newSnow: depthReading(payload.depthOfSnowfall, payload.depthOfSnowfallIsTrace),
    depth: depthReading(payload.depthOfSnowOnGround, payload.depthOfSnowOnGroundIsTrace),
  }
}

async function response(url: string, signal: AbortSignal) {
  const result = await fetch(url, { signal })
  if (!result.ok) throw new Error(`数据源返回 HTTP ${result.status}`)
  return result
}

export async function getObservations(station: Station, signal: AbortSignal, now = Date.now()): Promise<Readings> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10000)])
  if (station.triplet) {
    const localDay = (offset: number) => new Date(now - 8 * hour + offset * 24 * hour).toISOString().slice(0, 10)
    const params = new URLSearchParams({
      stationTriplets: station.triplet, elements: 'SNWD', duration: 'HOURLY', periodRef: 'END',
      beginDate: localDay(-2), endDate: localDay(1), centralTendencyType: 'NONE', returnFlags: 'true',
    })
    const result = await response(`${awdb}?${params}`, requestSignal)
    return awdbReadings(await result.json(), station.triplet, now)
  }
  if (station.provider === 'cocorahs') {
    const result = await response('/api/observations/stowe', requestSignal)
    return cocorahsReadings(await result.json(), now)
  }
  const latest = (await (await response(`${amedas}/latest_time.txt`, requestSignal)).text()).trim()
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/.test(latest)) throw new Error('AMeDAS 时间格式异常')
  const day = latest.slice(0, 10).replaceAll('-', '')
  const block = String(Math.floor(Number(latest.slice(11, 13)) / 3) * 3).padStart(2, '0')
  const result = await response(`${amedas}/point/16217/${day}_${block}.json`, requestSignal)
  return amedasReadings(await result.json(), now)
}
