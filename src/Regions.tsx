import { memo, useEffect, useState } from 'react'

import { RegionMap, type MapRegion } from './RegionMap'

const regions = [
  ['阿拉斯加南岸', 'Alyeska / Thompson Pass', 60.96, -149.08, 61.13, -145.73],
  ['太平洋西北沿海山地', 'Whistler / Mount Baker', 50.06, -122.95, 48.86, -121.68],
  ['内华达山脉', 'Palisades Tahoe / Mammoth', 39.19, -120.26, 37.64, -119.03],
  ['加拿大哥伦比亚山系', 'Revelstoke / Rogers Pass', 50.96, -118.16, 51.30, -117.52],
  ['加拿大落基山脉', 'Lake Louise / Sunshine', 51.45, -116.15, 51.08, -115.77],
  ['瓦萨奇山脉', 'Alta / Brighton', 40.58, -111.64, 40.60, -111.58],
  ['科罗拉多中部高地', 'Copper / Breckenridge', 39.48, -106.16, 39.47, -106.10],
  ['北部新英格兰', 'Stowe / Jay Peak', 44.53, -72.78, 44.93, -72.53],
] as const

const centers: MapRegion['center'][] = regions.map(r => [(r[2] + r[4]) / 2, (r[3] + r[5]) / 2])

type Sample = { daily_units: { snowfall_sum: string }; daily: { time: string[]; snowfall_sum: (number | null)[] } }

export const Regions = memo(function Regions() {
  const [selected, setSelected] = useState<string | null>(null)
  const [samples, setSamples] = useState<Sample[]>()
  const [error, setError] = useState('')
  const [revision, refresh] = useState(0)
  const [week, select] = useState(1)
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({
      latitude: regions.flatMap(r => [r[2], r[4]]).join(','),
      longitude: regions.flatMap(r => [r[3], r[5]]).join(','),
      forecast_days: '14', daily: 'snowfall_sum', models: 'gfs_seamless', timezone: 'GMT',
    })
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)])
    async function load() {
      if (import.meta.env.VITE_HOSTED_FORECAST === '1') {
        const permit = await fetch('/api/quota/regions', { method: 'POST', signal })
        if (!permit.ok) throw new Error(permit.status === 429 ? '本站预报额度已用完，请稍后刷新。' : '无法获取预报额度')
      }
      return fetch('https://api.open-meteo.com/v1/forecast?' + query, { signal })
    }
    load()
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
      const days = samples?.[2 * i + j].daily.snowfall_sum.slice(week * 7, week * 7 + 7)
      return days?.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
        ? days.reduce<number>((a, b) => a + b!, 0) : null
    })
    const floor = totals.every(v => v !== null) ? Math.min(...totals) : -1
    return { name, points, totals, floor, center: centers[i] }
  }).sort((a, b) => b.floor - a.floor)
  return <section className="region-page"><div className="region-tools"><strong>{samples ? samples[0].daily.time[week * 7] + ' — ' + samples[0].daily.time[week * 7 + 6] : '北美山地'}</strong><div className="controls">
    <label>移动窗口 <select value={week} onChange={e => select(Number(e.target.value))}><option value={0}>第 1 周</option><option value={1}>第 2 周</option></select></label>
    <button onClick={() => { setError(''); setSamples(undefined); refresh(revision + 1) }}>刷新预报</button></div></div>
    <RegionMap centers={centers} rows={rows} selected={selected} onSelect={setSelected} />
    {error ? <p role="alert">{error}</p> : !samples ? <p role="status">正在获取北美山地预报…</p> : <>
      <h2>区域对比</h2>
      <p>按两个代表点中较低的周累计新雪排序。两点都看好时，可优先核查该区；点间差距大时，需细看目的地。第 2 周仅供初筛。</p>
      <table><thead><tr><th>山地气候区</th><th>代表点</th><th>各点新雪（cm）</th></tr></thead><tbody>{rows.map(r => <tr key={r.name}><th><button aria-pressed={selected === r.name} onClick={() => setSelected(r.name)}>{r.name}</button></th><td>{r.points}</td><td>{r.totals.map(v => v?.toFixed(1) ?? '缺测').join(' / ')}</td></tr>)}</tbody></table>
      <p>GFS 单模型 · UTC 日界 · 代表坐标按模型地形估算。相邻点可能落在同一网格。</p></>}
    <h3>第 3–4 周</h3><p>美国区域可结合气温与降水距平概率筛选冷湿重叠区，再等第 2 周新雪预报确认。</p><a href="https://www.cpc.ncep.noaa.gov/products/predictions/WK34/">查看 NOAA 第 3–4 周展望</a>
  </section>
})
