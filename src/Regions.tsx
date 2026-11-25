import { memo, useEffect, useState } from 'react'

import { PeriodPicker } from './PeriodPicker'
import { defaultPeriod, forecastPeriods } from './weather'
import { RegionMap, boundaries, snowQuality, type SnowQuality } from './RegionMap'
import { snow } from './weather'
import { temp, type Units } from './units'

const regions = [
  ['太平洋西北沿海山地', 'Whistler / Mount Baker', 50.06, -122.95, 48.86, -121.68],
  ['内华达山脉', 'Palisades Tahoe / Mammoth', 39.19, -120.26, 37.64, -119.03],
  ['加拿大哥伦比亚山系', 'Revelstoke / Rogers Pass', 50.96, -118.16, 51.30, -117.52],
  ['加拿大落基山脉', 'Lake Louise / Sunshine', 51.45, -116.15, 51.08, -115.77],
  ['提顿山脉', 'Jackson Hole / Grand Targhee', 43.59, -110.85, 43.79, -110.95],
  ['蒙大拿麦迪逊山脉', 'Big Sky / Moonlight Basin', 45.28, -111.43, 45.30, -111.45],
  ['圣胡安山脉', 'Telluride / Wolf Creek', 37.92, -107.84, 37.47, -106.79],
  ['俄勒冈胡德山', 'Timberline / Mt. Hood Meadows', 45.34, -121.71, 45.34, -121.67],
  ['瓦萨奇山脉', 'Alta / Brighton', 40.58, -111.64, 40.60, -111.58],
  ['科罗拉多中部高地', 'Copper / Breckenridge', 39.48, -106.16, 39.47, -106.10],
] as const


type Sample = { daily_units: Record<string, string>; daily: { time: string[]; snowfall_sum: (number | null)[]; rain_sum?: (number | null)[]; temperature_2m_min?: (number | null)[]; temperature_2m_max?: (number | null)[] } }

function conditions(sample: Sample | undefined, start: number, end: number, units: Units) {
  if (!sample) return { text: '等待预报', qualities: [] }
  const lows = sample.daily.temperature_2m_min?.slice(start, end)
  const highs = sample.daily.temperature_2m_max?.slice(start, end)
  const complete = (v: (number | null)[] | undefined): v is number[] =>
    v?.length === end - start && v.every(n => typeof n === 'number' && Number.isFinite(n))
  if (sample.daily_units.temperature_2m_min !== '°C' || sample.daily_units.temperature_2m_max !== '°C' ||
    !complete(lows) || !complete(highs) || lows.some((v,i) => v > highs[i])) return { text: '气温缺测', qualities: [] }
  const range = temp(Math.min(...lows), units) + '～' + temp(Math.max(...highs), units) + ' ' + units.temperature
  const snowfall = sample.daily.snowfall_sum.slice(start, end)
  if (!complete(snowfall) || snowfall.some(n => n < 0)) return { text: range + ' · 新雪缺测', qualities: [] }
  const first = snowfall.findIndex(n => n > 0)
  if (first < 0) return { text: range + ' · 无新增降雪', qualities: [] }
  const warmSnowDay = snowfall.some((n,i) => n > 0 && highs[i] > 0)
  const thaw = highs.slice(first + 1).some(n => n > 0)
  const rain = sample.daily.rain_sum?.slice(start, end)
  const qualities = [...new Set(snowfall.flatMap((amount, i): SnowQuality[] => {
    if (amount === 0) return []
    if (sample.daily_units.rain_sum === 'mm' && (rain?.[i] ?? 0) > 0) return ['mix']
    return [highs[i] <= -4 ? 'powder' : 'cement']
  }))]
  return { qualities, text: range + (warmSnowDay ? ' · 降雪日有湿化风险' : '') +
    (thaw ? ' · 后续有回暖风险' : '') + ' · ' + qualities.map(q => snowQuality[q].name).join(' / ') }
}

export const Regions = memo(function Regions({ units }: { units: Units }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [samples, setSamples] = useState<Sample[]>()
  const [error, setError] = useState('')
  const [revision, refresh] = useState(0)
  const [period, select] = useState(defaultPeriod)
  const [, start, end] = forecastPeriods[period]
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({
      latitude: regions.flatMap(r => [r[2], r[4]]).join(','),
      longitude: regions.flatMap(r => [r[3], r[5]]).join(','),
      forecast_days: '14', daily: 'snowfall_sum,rain_sum,temperature_2m_min,temperature_2m_max', models: 'gfs_seamless', timezone: 'GMT',
    })
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)])
    fetch('https://api.open-meteo.com/v1/forecast?' + query, { signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('预报服务返回 ' + response.status)
        const data: Sample[] = await response.json()
        const today = new Date().toISOString().slice(0, 10)
        if (!Array.isArray(data) || data.length !== regions.length * 2 || data.some(s =>
          s.daily_units?.snowfall_sum !== 'cm' || s.daily?.time?.length !== 14 || s.daily.time[0] !== today ||
          s.daily.snowfall_sum?.length !== 14 || s.daily.time.join() !== data[0].daily.time.join()
        )) throw new Error('预报日期、单位或采样点不完整')
        if (!controller.signal.aborted) setSamples(data)
      }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [revision])
  const rows = regions.map(([name, points], i) => {
    const totals = [0, 1].map(j => {
      const days = samples?.[2 * i + j].daily.snowfall_sum.slice(start, end)
      return days?.length === end - start && days.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
        ? days.reduce<number>((a, b) => a + b!, 0) : null
    })
    const floor = totals.every(v => v !== null) ? Math.min(...totals) : -1
    return { name, points, totals, floor, conditions: [0, 1].map(j => conditions(samples?.[2 * i + j], start, end, units)), boundary: boundaries[name] }
  }).sort((a, b) => b.floor - a.floor)
  const dates = samples?.[0].daily.time
  return <section className="region-page"><div className="region-tools">
    <PeriodPicker period={period} onSelect={select} />
    {dates && <small aria-live="polite">
      {dates[start].slice(5)}{end - start > 1 && ' — ' + dates[end - 1].slice(5)}
    </small>}
    <div className="controls">
    <button onClick={() => { setError(''); setSamples(undefined); refresh(revision + 1) }}>刷新预报</button></div></div>
    <RegionMap units={units} rows={rows} selected={selected} onSelect={setSelected} />
    {error ? <p role="alert">{error}</p> : !samples ? <p role="status">正在获取北美山地预报…</p> : <>
      <h2>区域对比</h2>
      <div className="table-scroll" tabIndex={0} aria-label="区域对比，可横向滚动"><table style={{minWidth:680}}><thead><tr><th>山地气候区</th><th>代表点</th><th>各点新雪（{units.snow}）</th><th>气温与雪质趋势</th></tr></thead><tbody>{rows.map(r => <tr key={r.name}><th><button aria-pressed={selected === r.name} onClick={() => setSelected(r.name)}>{r.name}</button></th><td>{r.points}</td><td>{r.totals.map(v => v === null ? '缺测' : snow(v, units.snow)).join(' / ')}</td><td>{r.conditions.map((c,i) => <div key={i}>{r.points.split(' / ')[i]}：{c.text}</div>)}</td></tr>)}</tbody></table></div>
      </>}
    
  </section>
})
