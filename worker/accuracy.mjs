import { models } from '../src/weather.ts'

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
