import { fixed } from './weather.ts'

export const unitOptions = {
  snow: { label: '降雪', options: ['cm', 'in'] },
  temperature: { label: '温度', options: ['°C', '°F'] },
  wind: { label: '风速', options: ['km/h', 'mph'] },
  elevation: { label: '海拔', options: ['m', 'ft'] },
} as const
export type Units = { [K in keyof typeof unitOptions]: typeof unitOptions[K]['options'][number] }
export const metric: Units = { snow: 'cm', temperature: '°C', wind: 'km/h', elevation: 'm' }
export const imperial: Units = { snow: 'in', temperature: '°F', wind: 'mph', elevation: 'ft' }

const key = 'snow-units'
export const validUnits = (input: unknown): input is Units => typeof input === 'object' && input !== null && Object.keys(input).length === Object.keys(unitOptions).length &&
  (Object.keys(unitOptions) as (keyof Units)[]).every(k => (unitOptions[k].options as readonly unknown[]).includes((input as Record<string, unknown>)[k]))
export function readUnits(storage: () => Storage): Units {
  try {
    const parsed: unknown = JSON.parse(storage().getItem(key) ?? '')
    if (validUnits(parsed)) return parsed
  } catch {}
  return metric
}
export const saveUnits = (units: Units, storage: () => Storage) => storage().setItem(key, JSON.stringify(units))

export const temp = (n: number | null, units: Units) => fixed(n === null || units.temperature === '°C' ? n : n * 9 / 5 + 32)
export const wind = (n: number | null, units: Units) => fixed(n === null || units.wind === 'km/h' ? n : n / 1.609344)
export const elevation = (n: number, units: Units) => Math.round(units.elevation === 'm' ? n : n / 0.3048).toLocaleString('zh-CN')
