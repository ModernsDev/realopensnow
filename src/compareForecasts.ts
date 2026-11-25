import { value, type Forecast } from './weather.ts'

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
