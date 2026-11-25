import { resorts, queryBlockReason, type Resort, type QueryPoint } from './catalog.ts'
export { resorts } from './catalog.ts'
export type { Resort } from './catalog.ts'
export const models = [{ id: 'ecmwf_ifs025', name: 'ECMWF', color: '#1d5fc4' }, { id: 'gfs_seamless', name: 'GFS', color: '#23a094' }, { id: 'icon_seamless', name: 'ICON', color: '#ec8a32' }]
export type Forecast = {
  dates: string[]; daily: Record<string, (number | null)[]>; requested: string; fetched: string
  source: string; elevation: number; timezone: string
  grid: { lat: number; lon: number }; modelStatus: Record<string, string>
  query: { resortId: string; pointId: string; lat: number; lon: number; elevation: number; timezone: string }
}
export type ForecastWithReport = Forecast & { extended: Forecast; report: ReturnType<typeof dailyReport>; reportGenerated: string }
export const forecastPeriods = [
  ['今天', 0, 1],
  ['明天', 1, 2],
  ['后天', 2, 3],
  ['未来 3 天', 0, 3],
  ['未来 7 天', 0, 7],
  ['未来 14 天', 0, 14],
  ['第 8–14 天', 7, 14],
] as const
export const defaultPeriod = 4
export const value = (f: Forecast, field: string, model: string, i: number) => f.daily[`${field}_${model}`]?.[i] ?? null
export function total(f: Forecast, model: string) {
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
    const fields = Object.entries(daily).filter(([key]) => key.endsWith(`_${id}`)).flatMap(([, values]) => values)
    return [id, fields.every(v => v !== null) ? '数据完整' : fields.some(v => v !== null) ? '部分缺失，— 不参与完整周期总量' : '不可用']
  }))
}
export function slicePeriod(data: Forecast, start: number, end: number): Forecast {
  const daily = Object.fromEntries(Object.entries(data.daily).map(([key, values]) => [key, values.slice(start, end)]))
  return { ...data, dates: data.dates.slice(start, end), daily, modelStatus: statuses(daily) }
}
export function aggregateHourly(data: unknown, dates: string[], timezone: string) {
  const raw = data as { timezone?: string; hourly?: Record<string, unknown>; hourly_units?: Record<string, unknown> }
  const times = raw?.hourly?.time
  if (raw?.timezone !== timezone || raw.hourly_units?.time !== 'unixtime' || !Array.isArray(times) || !times.length || times.some((t, i) => !Number.isSafeInteger(t) || t % 3600 !== 0 || (i > 0 && t - times[i - 1] !== 3600))) throw new Error('天气服务的时区或小时时间轴无效')
  const daily: Forecast['daily'] = {}
  const labelsByShift = [0, 1].map(shift => times.map(t => localDate(t * 1000 - shift, timezone)))
  for (const model of models) {
    for (const [field, output, unit, operation] of [
      ['snowfall', 'snowfall_sum', 'cm', 'sum'],
      ['temperature_2m', 'temperature_2m_min', '°C', 'min'],
      ['temperature_2m', 'temperature_2m_max', '°C', 'max'],
      ['wind_gusts_10m', 'wind_gusts_10m_max', 'km/h', 'max'],
    ]) {
      const shift = field === 'temperature_2m' ? 0 : 1
      const labels = labelsByShift[shift]
      const key = `${field}_${model.id}`
      const values = raw.hourly![key]
      daily[`${output}_${model.id}`] = dates.map(date => {
        const indices = labels.flatMap((label, i) => label === date ? [i] : [])
        if (!indices.length || localDate((times[indices[0]] - 3600) * 1000 - shift, timezone) === date || localDate((times[indices.at(-1)!] + 3600) * 1000 - shift, timezone) === date || !Array.isArray(values) || values.length !== times.length || raw.hourly_units![key] !== unit) return null
        const selected = indices.map(i => values[i])
        if (selected.some(v => typeof v !== 'number' || !Number.isFinite(v) || (field !== 'temperature_2m' && v < 0))) return null
        return operation === 'sum' ? selected.reduce((a, b) => a + b, 0) : operation === 'min' ? Math.min(...selected) : Math.max(...selected)
      })
    }
  }
  return { daily, modelStatus: statuses(daily) }
}
export function forecastSource(lat: number, lon: number, elevation: number, timezone: string, days = 7) {
  const query = new URLSearchParams({ latitude: String(lat), longitude: String(lon), elevation: String(elevation), timezone, forecast_days: String(days + 1), past_days: '1', models: models.map(m => m.id).join(','), hourly: 'snowfall,temperature_2m,wind_gusts_10m', timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm' })
  return `https://api.open-meteo.com/v1/forecast?${query}`
}

export async function forecast(resort: Resort, point: QueryPoint, signal?: AbortSignal): Promise<ForecastWithReport> {
  const blocked = queryBlockReason(resort, point)
  if (blocked) throw new Error(blocked)
  const { lat, lon } = point.coordinates.value!
  const elevation = point.elevation.value!
  const requested = new Date().toISOString()
  const hosted = import.meta.env?.VITE_HOSTED_FORECAST === '1'
  const source = forecastSource(lat, lon, elevation, resort.timezone, 14)
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
  let data
  try {
    const response = await fetch(source, { cache: 'no-store', signal: requestSignal })
    if (response.status === 429) throw new Error('天气服务已限流（429），请稍后重试。')
    if (!response.ok) throw new Error(`天气服务请求失败（${response.status}）`)
    data = await response.json()
  } catch (error) {
    if (hosted && !signal?.aborted) {
      const kind = error instanceof Error && error.message.includes('429') ? 'rate_limit' : 'request'
      navigator.sendBeacon(`/api/weather-error/${point.id}?kind=${kind}`)
    }
    throw error
  }
  const fetched = new Date().toISOString()
  const extended = forecastBatch(data, resort, point, requested, fetched, 14)
  const batch = slicePeriod(extended, 0, 7)
  const report = dailyReport(batch)
  return { ...batch, extended, report, reportGenerated: new Date().toISOString() }
}

export function forecastBatch(data: { error?: boolean; elevation: number; latitude: number; longitude: number }, resort: Resort, point: QueryPoint, requested: string, fetched: string, days = 7): Forecast {
  const { lat, lon } = point.coordinates.value!
  const elevation = point.elevation.value!
  const dates = forecastDates(requested, resort.timezone, days)
  const source = forecastSource(lat, lon, elevation, resort.timezone, days)
  if (data.error) throw new Error('天气服务返回错误，无法生成预报')
  if (data.elevation !== elevation || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) throw new Error('天气服务返回的查询高度或网格坐标无效')
  const aggregated = aggregateHourly(data, dates, resort.timezone)
  return { dates, ...aggregated, requested, fetched, source, elevation, timezone: resort.timezone, grid: { lat: data.latitude, lon: data.longitude }, query: { resortId: resort.id, pointId: point.id, lat, lon, elevation, timezone: resort.timezone } }
}

export function reportBlockReason(data: Forecast) {
  const location = data.query
  const resort = resorts.find(r => r.id === location?.resortId)
  const point = resort?.points.find(p => p.id === location?.pointId)
  if (!resort || !point) return '缺少已核实查询点，暂不生成雪报。'
  const blocked = queryBlockReason(resort, point)
  if (blocked) return blocked
  const coordinates = point.coordinates.value!
  if (location.lat !== coordinates.lat || location.lon !== coordinates.lon || location.elevation !== point.elevation.value || location.timezone !== resort.timezone) return '查询点证据已变更，请重新获取预报后生成雪报。'
  return null
}

export function dailyReport(data: Forecast) {
  const blocked = reportBlockReason(data)
  if (blocked) return { blocked } as const
  if (data.dates.length !== 7) return { blocked: '预报未覆盖完整的七个当地日期。' } as const
  const gaps = models.flatMap(model => {
    const fields = [
      ['降雪', ['snowfall_sum']],
      ['阵风', ['wind_gusts_10m_max']],
      ['气温', ['temperature_2m_min', 'temperature_2m_max']],
    ] as const
    const missing = fields.filter(([, keys]) => keys.some(key => data.dates.some((_, i) => value(data, key, model.id, i) === null)))
    return missing.length ? [`${model.name} ${missing.map(([label]) => label).join('、')}`] : []
  })
  if (gaps.length) return { blocked: `七日预报数据不完整，缺少 ${gaps.join('；')}。` } as const
  const today = models.map(({ id, name }) => ({
    name,
    snowfall: value(data, 'snowfall_sum', id, 0)!,
    gust: value(data, 'wind_gusts_10m_max', id, 0)!,
    minTemp: value(data, 'temperature_2m_min', id, 0)!,
    maxTemp: value(data, 'temperature_2m_max', id, 0)!,
    total: total(data, id)!,
  }))
  return {
    today,
    lowTotal: Math.min(...today.map(model => model.total)),
    highTotal: Math.max(...today.map(model => model.total)),
    gust: Math.max(...today.map(model => model.gust)),
    lowTemp: Math.min(...today.map(model => model.minTemp)),
    highTemp: Math.max(...today.map(model => model.maxTemp)),
  }
}
