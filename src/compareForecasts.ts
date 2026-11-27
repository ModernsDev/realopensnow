import { upcomingNights, value, type Forecast, type ForecastWithReport } from './weather.ts'
import { snowQuality } from './snowQuality.ts'

export function compareForecasts(forecasts: (Forecast | undefined)[], model: string) {
  const available = forecasts.filter(f => f !== undefined)
  const dates = available.length
    ? available[0].dates.filter(date => available.every(f => f.dates.includes(date)))
    : []
  const columns = forecasts.map((forecast, index) => {
    const days = dates.map(date => {
      const i = forecast?.dates.indexOf(date) ?? -1
      return {
        snow: forecast ? value(forecast, 'snowfall_sum', model, i) : null,
        low: forecast ? value(forecast, 'temperature_2m_min', model, i) : null,
        high: forecast ? value(forecast, 'temperature_2m_max', model, i) : null,
        gust: forecast ? value(forecast, 'wind_gusts_10m_max', model, i) : null,
      }
    })
    const total = days.length && days.every(day => day.snow !== null)
      ? days.reduce((sum, day) => sum + day.snow!, 0)
      : null
    return { index, days, total }
  })
  columns.sort((a, b) => (b.total ?? -1) - (a.total ?? -1))
  const totals = columns.map(column => column.total)
  return {
    dates,
    columns: columns.map(column => ({
      ...column,
      rank: column.total === null ? null : totals.indexOf(column.total) + 1,
    })),
  }
}

export function compareNights(forecasts: (ForecastWithReport | undefined)[], model: string, count: number, now: number) {
  const upcoming = forecasts.map(f => f ? upcomingNights(f.periods, now, count) : [])
  const size = Math.min(...upcoming.filter((_, i) => forecasts[i]).map(nights => nights.length))
  const columns = forecasts.map((forecast, index) => {
    const nights = upcoming[index].slice(0, size).map(i => ({
      morning: nextDate(forecast!.periods.periods[i].date),
      snow: value(forecast!.periods, 'snowfall_sum', model, i),
      grade: snowQuality(forecast!.periods, i),
      hours: forecast!.periods.periods[i].hours,
    }))
    const total = nights.length && nights.every(night => night.snow !== null) ? nights.reduce((sum, night) => sum + night.snow!, 0) : null
    return { index, nights, total }
  })
  const mornings = Array.from({ length: Number.isFinite(size) ? size : 0 }, (_, k) => [...new Set(columns.flatMap(c => c.nights[k] ? [c.nights[k].morning] : []))])
  columns.sort((a, b) => (b.total ?? -1) - (a.total ?? -1))
  const totals = columns.map(column => column.total)
  return { mornings, columns: columns.map(column => ({ ...column, rank: column.total === null ? null : totals.indexOf(column.total) + 1 })) }
}

const nextDate = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
