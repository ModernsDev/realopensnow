import { memo, useEffect, useState } from 'react'

import { RegionMap, boundaries, snowQuality, type SnowQuality } from './RegionMap'

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

const periods = [
  ['今天', 0, 1],
  ['明天', 1, 2],
  ['后天', 2, 3],
  ['未来 7 天', 0, 7],
  ['未来 14 天', 0, 14],
  ['第 8–14 天', 7, 14],
] as const

function conditions(sample: Sample | undefined, start: number, end: number) {
  if (!sample) return { text: '等待预报', qualities: [] }
  const lows = sample.daily.temperature_2m_min?.slice(start, end)
  const highs = sample.daily.temperature_2m_max?.slice(start, end)
  const complete = (v: (number | null)[] | undefined): v is number[] =>
    v?.length === end - start && v.every(n => typeof n === 'number' && Number.isFinite(n))
  if (sample.daily_units.temperature_2m_min !== '°C' || sample.daily_units.temperature_2m_max !== '°C' ||
    !complete(lows) || !complete(highs) || lows.some((v,i) => v > highs[i])) return { text: '气温缺测', qualities: [] }
  const range = Math.min(...lows) + '～' + Math.max(...highs) + ' °C'
  const snow = sample.daily.snowfall_sum.slice(start, end)
  if (!complete(snow) || snow.some(n => n < 0)) return { text: range + ' · 新雪缺测', qualities: [] }
  const first = snow.findIndex(n => n > 0)
  if (first < 0) return { text: range + ' · 无新增降雪', qualities: [] }
  const warmSnowDay = snow.some((n,i) => n > 0 && highs[i] > 0)
  const thaw = highs.slice(first + 1).some(n => n > 0)
  const rain = sample.daily.rain_sum?.slice(start, end)
  const qualities = [...new Set(snow.flatMap((amount, i): SnowQuality[] => {
    if (amount === 0) return []
    if (sample.daily_units.rain_sum === 'mm' && (rain?.[i] ?? 0) > 0) return ['mix']
    return [highs[i] <= -4 ? 'powder' : 'cement']
  }))]
  return { qualities, text: range + ' · ' + (warmSnowDay ? '降雪日有湿化风险' : '降雪日全天冰点以下或持平') +
    (thaw ? ' · 后续有回暖风险' : '') + ' · ' + qualities.map(q => snowQuality[q].name).join(' / ') }
}

export const Regions = memo(function Regions() {
  const [selected, setSelected] = useState<string | null>(null)
  const [samples, setSamples] = useState<Sample[]>()
  const [error, setError] = useState('')
  const [revision, refresh] = useState(0)
  const [period, select] = useState(3)
  const [, start, end] = periods[period]
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
    return { name, points, totals, floor, conditions: [0, 1].map(j => conditions(samples?.[2 * i + j], start, end)), boundary: boundaries[name] }
  }).sort((a, b) => b.floor - a.floor)
  const dates = samples?.[0].daily.time
  return <section className="region-page"><div className="region-tools">
    <div className="forecast-periods" role="group" aria-label="预报时段">
      {periods.map(([label], index) => (
        <button key={label} aria-pressed={period === index} onClick={() => select(index)}>{label}</button>
      ))}
    </div>
    {dates && <small aria-live="polite">
      {dates[start].slice(5)}{end - start > 1 && ' — ' + dates[end - 1].slice(5)} · UTC
    </small>}
    <div className="controls">
    <button onClick={() => { setError(''); setSamples(undefined); refresh(revision + 1) }}>刷新预报</button></div></div>
    <RegionMap rows={rows} selected={selected} onSelect={setSelected} />
    {error ? <p role="alert">{error}</p> : !samples ? <p role="status">正在获取北美山地预报…</p> : <>
      <h2>区域对比</h2>
      <p>按两个代表点中较低的累计新雪排序。两点都看好时，可优先核查该区；点间差距大时，需细看目的地。第 2 周仅供初筛。</p>
      <div className="table-scroll" tabIndex={0} aria-label="区域对比，可横向滚动"><table style={{minWidth:680}}><thead><tr><th>山地气候区</th><th>代表点</th><th>各点新雪（cm）</th><th>气温与雪质趋势</th></tr></thead><tbody>{rows.map(r => <tr key={r.name}><th><button aria-pressed={selected === r.name} onClick={() => setSelected(r.name)}>{r.name}</button></th><td>{r.points}</td><td>{r.totals.map(v => v?.toFixed(1) ?? '缺测').join(' / ')}</td><td>{r.conditions.map((c,i) => <div key={i}>{r.points.split(' / ')[i]}：{c.text}</div>)}</td></tr>)}</tbody></table></div>
      <p>雪质按降雪日最高温粗分，最高温不超过 −4 °C 为普通粉倾向，更暖为水泥粉倾向。同日预报有雨和雪时标为冰水混合倾向。降雪日最高温超过 0 °C 提示湿化风险，首次降雪后的日最高温超过 0 °C 提示回暖风险。气温范围取所选时段的最低与最高气温，实际雪面还受风、日照和海拔影响。GFS 单模型 · UTC 日界 · 代表坐标按模型地形估算。相邻点可能落在同一网格。</p></>}
    <h3>第 3–4 周</h3><p>美国区域可结合气温与降水距平概率筛选冷湿重叠区，再等第 2 周新雪预报确认。</p><a href="https://www.cpc.ncep.noaa.gov/products/predictions/WK34/">查看 NOAA 第 3–4 周展望</a>
  </section>
})
