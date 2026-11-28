import { t } from './i18n.ts'
import { queryBlockReason, type Resort, type QueryPoint } from './catalog.ts'
export { resorts } from './catalog.ts'
export type { Resort } from './catalog.ts'
export const models = [
  { id: 'ecmwf_ifs025', name: 'ECMWF', color: '#1d5fc4', weight: 50 },
  { id: 'gfs_seamless', name: 'GFS', color: '#23a094', weight: 25 },
  { id: 'icon_seamless', name: 'ICON', color: '#ec8a32', weight: 25 },
  { id: 'ecmwf_aifs025_single', name: 'AIFS', color: '#7aa7ee', weight: 15 },
  { id: 'ncep_aigfs025', name: 'AIGFS', color: '#7bd0b8', weight: 10 },
  { id: 'ncep_nbm_conus', name: 'NBM', color: '#7a4fb5', weight: 20 },
  { id: 'gfs_hrrr', name: 'HRRR', color: '#c43d6b', weight: 10 },
  { id: 'gem_global', name: 'GDPS', color: '#8a6d3b', weight: 15 },
  { id: 'gem_regional', name: 'RDPS', color: '#c2a25a', weight: 10 },
  { id: 'gem_hrdps_continental', name: 'HRDPS', color: '#5c6f7f', weight: 10 },
  { id: 'icon_eu', name: 'ICON-EU', color: '#f2bd85', weight: 15 },
  { id: 'icon_d2', name: 'ICON-D2', color: '#a8501a', weight: 10 },
]
export const visibleModels = (f: Pick<DailySeries, 'hidden'>) => models.filter(m => !f.hidden?.includes(m.id))
const modelStatusFields = ['snowfall_sum', 'temperature_2m_min', 'temperature_2m_max', 'wind_gusts_10m_max']
export const availableModels = (f: DailySeries, field?: string) => visibleModels(f).filter(m => (field ? [field] : modelStatusFields).some(key => f.daily[`${key}_${m.id}`]?.some(n => n !== null)))
export const weighted = { id: 'weighted', name: t('加权综合', 'Weighted blend'), color: '#1559b7' }
export const modes = { simple: t('简化', 'Simple'), multi: t('多模型比较', 'Compare models') } as const
export type Mode = keyof typeof modes
export type Weights = Record<string, number>
export const defaultWeights: Weights = Object.fromEntries(models.map(m => [m.id, m.weight]))
export function weightShares(weights: Weights, ids = models.map(m => m.id)): Weights {
  const sum = ids.reduce((n, id) => n + weights[id], 0)
  return Object.fromEntries(ids.map(id => [id, Math.round(weights[id] / sum * 1000) / 10]))
}
export function weightLabel(weights: Weights = defaultWeights, f?: DailySeries) {
  const used = models.filter(m => weights[m.id] > 0 && (!f || Object.keys(f.daily).some(key => key.endsWith(`_${m.id}`) && f.daily[key].some(n => n !== null))))
  const shares = weightShares(weights, used.map(m => m.id))
  return used.map(m => `${m.name} ${shares[m.id]}%`).join(' · ')
}
export type Forecast = {
  weights?: Weights
  hidden?: string[]
  dates: string[]; daily: Record<string, (number | null)[]>; requested: string; fetched: string
  source: string; elevation: number; timezone: string
  grid: { lat: number; lon: number }; modelStatus: Record<string, string>
  query: { resortId: string; pointId: string; lat: number; lon: number; elevation: number; timezone: string }
}
export type DailySeries = Pick<Forecast, 'dates' | 'daily' | 'weights' | 'hidden'>
export type DayPart = 'day' | 'night'
export type PeriodSeries = DailySeries & { periods: { date: string; part: DayPart; start: number; end: number; hours: number }[] }
export type ForecastWithReport = Forecast & { extended: Forecast; past: DailySeries; periods: PeriodSeries; report: ReturnType<typeof dailyReport> }
export const forecastPeriods = [
  [t('今天', 'Today'), 0, 1],
  [t('明天', 'Tomorrow'), 1, 2],
  [t('后天', 'Day after tomorrow'), 2, 3],
  [t('未来 3 天', 'Next 3 days'), 0, 3],
  [t('未来 7 天', 'Next 7 days'), 0, 7],
  [t('未来 14 天', 'Next 14 days'), 0, 14],
  [t('第 8–14 天', 'Days 8–14'), 7, 14],
] as const
export const defaultPeriod = 4
export type Period = readonly [string, number, number]
export const timeline = { min: -7, max: 14 } as const
export const offsetLabel = (n: number) => n === 0 ? t('今天', 'today') : n === -1 ? t('昨天', 'yesterday') : n === 1 ? t('明天', 'tomorrow') : n < 0 ? t(`${-n} 天前`, `${-n} days ago`) : t(`${n} 天后`, `in ${n} days`)
export const defaultRange: [number, number] = [-7, 6]
const modelValues = (f: DailySeries, field: string, i: number, all = false) => (all ? models : visibleModels(f)).flatMap(m => {
  const n = f.daily[`${field}_${m.id}`]?.[i] ?? null
  return n === null ? [] : [{ ...m, n }]
})
export function value(f: DailySeries, field: string, model: string, i: number): number | null {
  if (model !== weighted.id) return f.daily[`${field}_${model}`]?.[i] ?? null
  const weights = f.weights ?? defaultWeights
  const enabled = models.filter(m => weights[m.id] > 0 && f.daily[`${field}_${m.id}`]?.some(n => n !== null)).length
  const available = modelValues(f, field, i, true).filter(m => weights[m.id] > 0)
  if (!available.length || available.length < Math.min(2, enabled)) return null
  return available.reduce((sum, m) => sum + m.n * weights[m.id], 0) / available.reduce((sum, m) => sum + weights[m.id], 0)
}
export function spread(f: DailySeries, field: string, i: number) {
  const values = modelValues(f, field, i).map(m => m.n)
  return values.length < 2 ? null : { low: Math.min(...values), high: Math.max(...values) }
}
export type AgreementLevel = 'agree' | 'split' | 'wide' | 'uncertain'
export type Agreement = { level: AgreementLevel; count: number }
export function agreement(values: number[]): Agreement | null {
  if (values.length < 2) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length / 2
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2
  const count = values.length
  if (median < 0.1 && sorted.at(-1)! >= 1) return { level: 'uncertain', count }
  const ratio = (sorted.at(-1)! - sorted[0]) / Math.max(median, 3)
  return { level: ratio <= 0.6 ? 'agree' : ratio <= 1.5 ? 'split' : 'wide', count }
}
export const agreementNames = { agree: t('一致', 'Agree'), split: t('有分歧', 'Mixed'), wide: t('严重分歧', 'Wide split'), uncertain: t('降雪不确定', 'Snow uncertain') }
export const agreementNote = t('一致性标签描述各模型降雪预报的分歧程度，不是降雪概率。「降雪不确定」表示多数模型无雪但部分模型报雪。', 'Agreement labels describe how far the models disagree on snowfall; they are not a probability of snow. "Snow uncertain" means most models show no snow but some do.')
export const snowAgreement = (f: DailySeries, i: number) => agreement(modelValues(f, 'snowfall_sum', i).map(m => m.n))
export function totalAgreement(f: DailySeries, indices = f.dates.map((_, i) => i)) {
  const totals = visibleModels(f).map(m => indices.map(i => f.daily[`snowfall_sum_${m.id}`]?.[i] ?? null)).filter((v): v is number[] => v.length > 0 && v.every(n => n !== null))
  return agreement(totals.map(v => v.reduce((a, b) => a + b, 0)))
}
export const fixed =(n: number | null) => n === null ? '—' : String(Math.round(n * 10) / 10)
export function total(f: DailySeries, model: string) {
  const values = f.dates.map((_, i) => value(f, 'snowfall_sum', model, i))
  return values.every(v => v !== null) ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null
}
export const snow = (n: number | null, unit: string) => n === null ? '—' : (n / (unit === 'in' ? 2.54 : 1)).toFixed(1)
export const localDate = (time: number, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)
export const forecastExpired = (data: Forecast, now: number) =>
  now - Date.parse(data.fetched) >= 6 * 3600000 || data.dates[0] !== localDate(now, data.timezone)

export function forecastDates(requested: string, timezone: string, days = 7) {
  const start = localDate(Date.parse(requested), timezone)
  return Array.from({ length: days }, (_, i) => new Date(Date.parse(`${start}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10))
}
function statuses(daily: Forecast['daily']): Forecast['modelStatus'] {
  return Object.fromEntries(models.map(({ id }) => {
    const fields = modelStatusFields.flatMap(field => daily[`${field}_${id}`] ?? [])
    return [id, fields.every(v => v !== null) ? '数据完整' : fields.some(v => v !== null) ? '部分缺失' : '不可用']
  }))
}
export function slicePeriod<T extends DailySeries>(data: T, start: number, end: number): T & Pick<Forecast, 'modelStatus'> {
  const daily = Object.fromEntries(Object.entries(data.daily).map(([key, values]) => [key, values.slice(start, end)]))
  return { ...data, dates: data.dates.slice(start, end), daily, modelStatus: statuses(daily) }
}
export function rangeSeries(data: Forecast & { past?: DailySeries; extended?: Forecast }, from: number, to: number) {
  const past = data.past && from < 0 ? slicePeriod({ ...data.past, weights: data.weights, hidden: data.hidden }, data.past.dates.length + from, data.past.dates.length + Math.min(to, -1) + 1) : undefined
  const future = to >= 0 ? { ...slicePeriod(data.extended ?? data, Math.max(from, 0), to + 1), weights: data.weights, hidden: data.hidden } : undefined
  return { past, future }
}
export function pastDates(requested: string, timezone: string) {
  const start = localDate(Date.parse(requested), timezone)
  return Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${start}T12:00:00Z`) + (i - 7) * 86400000).toISOString().slice(0, 10))
}
function readHourly(data: unknown, timezone: string) {
  const raw = data as { timezone?: string; hourly?: Record<string, unknown>; hourly_units?: Record<string, unknown> }
  const times = raw?.hourly?.time
  if (raw?.timezone !== timezone || raw.hourly_units?.time !== 'unixtime' || !Array.isArray(times) || !times.length || times.some((t, i) => !Number.isSafeInteger(t) || t % 3600 !== 0 || (i > 0 && t - times[i - 1] !== 3600))) throw new Error(t('天气服务的时区或小时时间轴无效', 'The weather service returned an invalid time zone or hourly time axis'))
  return { times: times as number[], hourly: raw.hourly!, units: raw.hourly_units }
}
export function aggregateHourly(data: unknown, dates: string[], timezone: string) {
  const raw = readHourly(data, timezone)
  const { times } = raw
  const indicesByShift = [0, 1].map(shift => {
    const labels = times.map(t => localDate(t * 1000 - shift, timezone))
    return dates.map(date => {
      const indices = labels.flatMap((label, i) => label === date ? [i] : [])
      if (!indices.length || localDate((times[indices[0]] - 3600) * 1000 - shift, timezone) === date || localDate((times[indices.at(-1)!] + 3600) * 1000 - shift, timezone) === date) return []
      return indices
    })
  })
  const daily = aggregateFields(raw, indicesByShift)
  return { daily, modelStatus: statuses(daily) }
}
function aggregateFields({ times, hourly, units }: ReturnType<typeof readHourly>, indicesByShift: number[][][]) {
  const daily: Forecast['daily'] = {}
  function aggregate(values: (number | null)[] | null, shift: 0 | 1, operation: 'sum' | 'min' | 'max') {
    return indicesByShift[shift].map(indices => {
      if (!indices.length || !values) return null
      const selected = indices.map(i => values[i] ?? null)
      if (!selected.every(n => n !== null)) return null
      return operation === 'sum' ? selected.reduce((a, b) => a + b, 0) : operation === 'min' ? Math.min(...selected) : Math.max(...selected)
    })
  }
  for (const { id } of models) {
    const read = (field: string, unit: string, allowNegative = false): (number | null)[] | null => {
      const key = `${field}_${id}`
      const values = hourly[key]
      if (!Array.isArray(values) || values.length !== times.length || units[key] !== unit) return null
      return values.map(n => typeof n === 'number' && Number.isFinite(n) && (allowNegative || n >= 0) ? n : null)
    }
    const snowfall = read('snowfall', 'cm')
    const temperature = read('temperature_2m', '°C', true)
    const freezing = read('freezing_level_height', 'm', true)
    const wetSnowfall = snowfall && temperature && snowfall.map((snow, i) => {
      const temp = temperature[i]
      if (snow === null || temp == null) return null
      return temp > -1 ? snow : 0
    })
    daily[`snowfall_sum_${id}`] = aggregate(snowfall, 1, 'sum')
    daily[`temperature_2m_min_${id}`] = aggregate(temperature, 0, 'min')
    daily[`temperature_2m_max_${id}`] = aggregate(temperature, 0, 'max')
    daily[`wind_gusts_10m_max_${id}`] = aggregate(read('wind_gusts_10m', 'km/h'), 1, 'max')
    daily[`rain_sum_${id}`] = aggregate(read('rain', 'mm'), 1, 'sum')
    daily[`wet_snowfall_sum_${id}`] = aggregate(wetSnowfall, 1, 'sum')
    daily[`freezing_level_height_min_${id}`] = aggregate(freezing, 0, 'min')
    daily[`freezing_level_height_max_${id}`] = aggregate(freezing, 0, 'max')
  }
  return daily
}
export function aggregatePeriods(data: unknown, dates: string[], timezone: string): PeriodSeries {
  const raw = readHourly(data, timezone)
  const hour = 3600000
  const zone = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'longOffset' })
  function offsetAt(time: number) {
    const name = zone.formatToParts(time).find(part => part.type === 'timeZoneName')!.value
    const [h, m = 0, s = 0] = name.slice(4).split(':').map(Number)
    return (name[3] === '-' ? -1 : 1) * (h * 3600 + m * 60 + s) * 1000
  }
  function toUtc(wallTime: number) {
    const estimate = wallTime - offsetAt(wallTime)
    return wallTime - offsetAt(estimate)
  }
  const periods = dates.flatMap(date => {
    const morning = Date.parse(`${date}T06:00:00Z`)
    const start = toUtc(morning)
    const evening = toUtc(morning + 12 * hour)
    const end = toUtc(morning + 24 * hour)
    return [
      { date, part: 'day' as const, start, end: evening, hours: (evening - start) / hour },
      { date, part: 'night' as const, start: evening, end, hours: (end - evening) / hour },
    ]
  })
  const first = raw.times[0] * 1000
  const indicesByShift = [0, 1].map(shift => periods.map(({ start, end }) => {
    const from = Math.ceil((start + shift - first) / hour)
    const until = Math.ceil((end + shift - first) / hour)
    if (from < 0 || until > raw.times.length) return []
    return Array.from({ length: until - from }, (_, i) => from + i)
  }))
  return { dates: periods.map(({ date, part }) => `${date}-${part}`), periods, daily: aggregateFields(raw, indicesByShift) }
}
export function upcomingNights(f: PeriodSeries, now: number, count: number): number[] {
  return f.periods.flatMap(({ part, end }, i) => part === 'night' && end > now ? [i] : []).slice(0, Math.max(0, count))
}
export function forecastSource(lat: number, lon: number, elevation: number, timezone: string, days = 7, pastDays = 1) {
  const query = new URLSearchParams({ latitude: String(lat), longitude: String(lon), elevation: String(elevation), timezone, forecast_days: String(days + 1), past_days: String(pastDays), models: models.map(m => m.id).join(','), hourly: 'snowfall,temperature_2m,wind_gusts_10m,rain,freezing_level_height', timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm' })
  return `https://api.open-meteo.com/v1/forecast?${query}`
}

export function pageSource(resort: Resort, point: QueryPoint) {
  const { lat, lon } = point.coordinates.value!
  return forecastSource(lat, lon, point.elevation.value!, resort.timezone, 15, 8)
}

export function pageForecast(data: Parameters<typeof forecastBatch>[0], resort: Resort, point: QueryPoint, requested: string, fetched: string): ForecastWithReport {
  const extended = { ...forecastBatch(data, resort, point, requested, fetched, 15), source: pageSource(resort, point) }
  const batch = slicePeriod(extended, 0, 7)
  const dates = pastDates(requested, resort.timezone)
  const past = { dates, daily: aggregateHourly(data, dates, resort.timezone).daily }
  const periods = aggregatePeriods(data, [...dates, ...extended.dates], resort.timezone)
  return { ...batch, extended, past, periods, report: dailyReport(batch, resort) }
}

async function storedForecast(point: QueryPoint, signal: AbortSignal) {
  const response = await fetch(`/api/forecast/${point.id}`, { cache: 'no-store', signal })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data: ForecastWithReport = await response.json()
  return forecastExpired(data, Date.now()) ? null : data
}

export async function forecast(resort: Resort, point: QueryPoint, signal?: AbortSignal): Promise<ForecastWithReport> {
  const blocked = queryBlockReason(resort, point)
  if (blocked) throw new Error(blocked)
  const requested = new Date().toISOString()
  const hosted = import.meta.env?.VITE_HOSTED_FORECAST === '1'
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
  if (hosted && !resort.custom) {
    try {
      const stored = await storedForecast(point, requestSignal)
      if (stored) return stored
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn('stored_forecast', point.id, error instanceof Error ? error.message : error)
    }
  }
  let data
  try {
    const response = await fetch(pageSource(resort, point), { cache: 'no-store', signal: requestSignal })
    if (response.status === 429) throw new Error(t('天气服务已限流（429），请稍后重试。', 'The weather service is rate limiting requests (429). Please try again later.'))
    if (!response.ok) throw new Error(t(`天气服务请求失败（${response.status}）`, `Weather service request failed (${response.status})`))
    data = await response.json()
  } catch (error) {
    if (hosted && !resort.custom && !signal?.aborted) {
      const kind = error instanceof Error && error.message.includes('429') ? 'rate_limit' : 'request'
      navigator.sendBeacon(`/api/weather-error/${point.id}?kind=${kind}`)
    }
    throw error
  }
  return pageForecast(data, resort, point, requested, new Date().toISOString())
}

export function forecastBatch(data: { error?: boolean; elevation: number; latitude: number; longitude: number }, resort: Resort, point: QueryPoint, requested: string, fetched: string, days = 7): Forecast {
  const { lat, lon } = point.coordinates.value!
  const elevation = point.elevation.value!
  const dates = forecastDates(requested, resort.timezone, days)
  const source = forecastSource(lat, lon, elevation, resort.timezone, days)
  if (data.error) throw new Error(t('天气服务返回错误，无法生成预报', 'The weather service returned an error; no forecast is available'))
  if (data.elevation !== elevation || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) throw new Error(t('天气服务返回的查询高度或网格坐标无效', 'The weather service returned an invalid elevation or grid position'))
  const aggregated = aggregateHourly(data, dates, resort.timezone)
  return { dates, ...aggregated, requested, fetched, source, elevation, timezone: resort.timezone, grid: { lat: data.latitude, lon: data.longitude }, query: { resortId: resort.id, pointId: point.id, lat, lon, elevation, timezone: resort.timezone } }
}

export function reportBlockReason(data: Forecast, resort: Resort) {
  const location = data.query
  if (location?.resortId !== resort.id) return t('查询点与当前地点不符，暂不生成雪报。', 'The query point does not match this location; no report is generated.')
  const point = resort.points.find(p => p.id === location.pointId)
  const blocked = queryBlockReason(resort, point)
  if (blocked) return blocked
  const coordinates = point!.coordinates.value!
  if (location.lat !== coordinates.lat || location.lon !== coordinates.lon || location.elevation !== point!.elevation.value || location.timezone !== resort.timezone) return t('查询点证据已变更，请重新获取预报后生成雪报。', 'The query point has changed. Reload the forecast to generate a report.')
  return null
}

export function dailyReport(data: Forecast, resort: Resort) {
  const blocked = reportBlockReason(data, resort)
  if (blocked) return { blocked } as const
  if (data.dates.length !== 7) return { blocked: t('预报未覆盖完整的七个当地日期。', 'The forecast does not cover seven full local days.') } as const
  const gaps = ([[t('降雪', 'snowfall'), ['snowfall_sum']], [t('阵风', 'gusts'), ['wind_gusts_10m_max']], [t('气温', 'temperature'), ['temperature_2m_min', 'temperature_2m_max']]] as const)
    .filter(([, keys]) => keys.some(key => data.dates.some((_, i) => value(data, key, weighted.id, i) === null))).map(([label]) => label)
  if (gaps.length) return { blocked: t(`七日预报数据不完整，加权综合缺少 ${gaps.join('、')}。`, `The 7-day forecast is incomplete: the weighted blend is missing ${gaps.join(', ')}.`) } as const
  const today = (field: string) => modelValues(data, field, 0).map(m => m.n)
  const totals = visibleModels(data).map(m => total(data, m.id)).filter(n => n !== null)
  return {
    today: modelValues(data, 'snowfall_sum', 0).map(({ name, n }) => ({ name, snowfall: n })),
    lowTotal: Math.min(...totals),
    highTotal: Math.max(...totals),
    gust: Math.max(...today('wind_gusts_10m_max')),
    lowTemp: Math.min(...today('temperature_2m_min')),
    highTemp: Math.max(...today('temperature_2m_max')),
  }
}
