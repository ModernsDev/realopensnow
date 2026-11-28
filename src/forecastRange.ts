import { defaultRange, timeline } from './weather.ts'

export type ForecastRange = [number, number]
const key = 'snow-forecast-range'
export const validForecastRange = (input: unknown): input is ForecastRange => Array.isArray(input) && input.length === 2 &&
  input.every(n => Number.isInteger(n) && n >= timeline.min && n <= timeline.max) && input[0] <= input[1]
export function readForecastRange(storage: () => Storage): ForecastRange {
  try {
    const parsed: unknown = JSON.parse(storage().getItem(key) ?? '')
    if (validForecastRange(parsed)) return parsed
  } catch {}
  return defaultRange
}
export const saveForecastRange = (range: ForecastRange, storage: () => Storage) => storage().setItem(key, JSON.stringify(range))
