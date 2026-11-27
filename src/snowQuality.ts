import { value, weighted, type DailySeries } from './weather.ts'

export type SnowGrade = 'unknown' | 'none' | 'light' | 'good' | 'excellent' | 'wet' | 'rain'

export const snowGrades: Record<SnowGrade, { name: string; rule: string }> = {
  unknown: { name: '未知', rule: '降雪量、降雨量或湿雪量缺少加权数据。' },
  none: { name: '无新雪', rule: '未达到雨的条件，且降雪量低于 0.1 cm。' },
  light: { name: '少量', rule: '未达到雨的条件，且降雪量至少为 0.1 cm、低于 2.5 cm。' },
  good: { name: '好', rule: '降雪量至少为 2.5 cm，降雨量低于 1 mm，湿雪占比低于 50%，且未达到极好条件。' },
  excellent: { name: '极好', rule: '降雪量至少为 12.5 cm，降雨量低于 1 mm，湿雪占比低于 20%，且前一日等级不是雨或湿雪。' },
  wet: { name: '湿雪', rule: '未达到雨的条件，降雪量至少为 2.5 cm，且降雨量至少为 1 mm 或湿雪占比达到 50% 及以上。' },
  rain: { name: '雨', rule: '降雨量至少为 1 mm，且不低于降雪的水当量（每 0.7 cm 雪折合 1 mm 水）。' },
}

export function snowQuality(f: DailySeries, i: number): { grade: SnowGrade; wetBefore: boolean } {
  const previous = i > 0 ? snowQuality(f, i - 1).grade : undefined
  const wetBefore = previous === 'rain' || previous === 'wet'
  const snow = value(f, 'snowfall_sum', weighted.id, i)
  const rain = value(f, 'rain_sum', weighted.id, i)
  const wet = value(f, 'wet_snowfall_sum', weighted.id, i)
  if (snow === null || rain === null || wet === null) return { grade: 'unknown', wetBefore }
  if (rain >= 1 && rain >= snow / 0.7) return { grade: 'rain', wetBefore }
  if (snow < 0.1) return { grade: 'none', wetBefore }
  if (snow < 2.5) return { grade: 'light', wetBefore }
  if (rain >= 1 || wet / snow >= 0.5) return { grade: 'wet', wetBefore }
  if (snow >= 12.5 && wet / snow < 0.2 && !wetBefore) return { grade: 'excellent', wetBefore }
  return { grade: 'good', wetBefore }
}

export function snowLevel(f: DailySeries, i: number): { low: number; high: number } | null {
  const low = value(f, 'freezing_level_height_min', weighted.id, i)
  const high = value(f, 'freezing_level_height_max', weighted.id, i)
  return low === null || high === null ? null : { low: low - 300, high: high - 300 }
}
