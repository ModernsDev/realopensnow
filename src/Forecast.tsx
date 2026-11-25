import { useRef } from 'react'
import { fixed, missingModels, modes, models, snow, spread, total, value, weighted, weightLabel, forecastPeriods, pastPeriods, defaultPeriod, slicePeriod, type Period, type DailySeries, type Mode, type Forecast, type ForecastWithReport, type Resort } from './weather'

export function ModeSwitch({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return <div className="mode-switch" role="group" aria-label="预报模式">{(Object.keys(modes) as Mode[]).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{modes[m]}</button>)}</div>
}
export function Report({ resort, data, unit, mode, inWorkspace = false }: { resort: Resort; data: ForecastWithReport; unit: string; mode: Mode; inWorkspace?: boolean }) {
  const { report: summary } = data
  const details = useRef<HTMLDetailsElement>(null)
  if ('blocked' in summary) return <div className="report" role="status"><p>每日雪报暂不可用。{summary.blocked}</p></div>
  const point = resort.points.find(p => p.id === data.query.pointId)!
  const detailId = `forecast-${resort.id}-${point.id}`
  return <article className="report" aria-label={`${resort.name} 每日雪报`}>
    {inWorkspace && <h2>每日雪报</h2>}
    <p>{inWorkspace && `${resort.name} · `}{point.name} · 查询海拔 {data.query.elevation} m</p>
    <p className="muted">{data.dates[0]}</p>
    {mode === 'simple' ? <>
      <p><strong>当日加权降雪</strong> · {snow(value(data, 'snowfall_sum', weighted.id, 0), unit)} {unit}</p>
      <p><strong>七日加权累计</strong> · {snow(total(data, weighted.id), unit)} {unit}（模型范围 {snow(summary.lowTotal, unit)}–{snow(summary.highTotal, unit)} {unit}）</p>
      <p><strong>当日加权阵风</strong> · {fixed(value(data, 'wind_gusts_10m_max', weighted.id, 0))} km/h</p>
      <p><strong>当日加权气温</strong> · {fixed(value(data, 'temperature_2m_min', weighted.id, 0))} 至 {fixed(value(data, 'temperature_2m_max', weighted.id, 0))} °C</p>
      <p className="muted">权重 {weightLabel(data.weights)}</p>
    </> : <>
    <p><strong>当日预报降雪</strong> · {summary.today.map(model => `${model.name} ${snow(model.snowfall, unit)} ${unit}`).join(' / ')}</p>
    <p><strong>七日模型分歧</strong> · {data.dates[0]} 至 {data.dates.at(-1)}，各模型累计预报降雪 {snow(summary.lowTotal, unit)}–{snow(summary.highTotal, unit)} {unit}</p>
    <p><strong>当日预报阵风</strong> · 各模型最高 {summary.gust} km/h</p>
    <p><strong>当日预报气温</strong> · 各模型最低至最高 {summary.lowTemp} 至 {summary.highTemp} °C</p>
    </>}
    
    <p><a href={`#${detailId}`} onClick={() => { if (details.current) details.current.open = true }}>预报明细</a></p>
    {!inWorkspace && <details id={detailId} ref={details}><summary>{mode === 'simple' ? '七日加权明细' : '七日各模型明细'}</summary><ForecastView resort={resort} data={data} unit={unit} mode={mode} /></details>}
  </article>
}
type Series = { id: string; name: string; color: string }
function SnowChart({ data, series, unit, split, marker }: { data: DailySeries; series: Series[]; unit: string; split: number; marker: string }) {
  const max = Math.max(1, ...series.flatMap(m => data.dates.map((_, i) => value(data, 'snowfall_sum', m.id, i) ?? 0)))
  return <div className="chart-scroll" tabIndex={0} role="region" aria-label="降雪图，可横向滚动"><div className={`chart days-${data.dates.length}`} aria-label="降雪柱状图">{data.dates.map((date, i) => <div className={`day${i < split ? ' past' : ''}${i === split && split > 0 ? ' today' : ''}`} key={date}>{i === split && split > 0 && <em>{marker}</em>}<div className="bars">{series.map(m => { const n = value(data, 'snowfall_sum', m.id, i); return <div className="bar-column" key={m.id}><span>{snow(n, unit)}</span><div title={`${date} ${m.name}: ${snow(n, unit)} ${unit}`} style={{ height: `${n === null ? 0 : n / max * 170}px`, minHeight: n === null ? 0 : undefined, background: m.color }} /></div> })}</div><span>{date.slice(5)}</span></div>)}</div></div>
}
export function ForecastView({ resort, data, unit, id, mode, pastDays = 7, period = forecastPeriods[defaultPeriod], archived = false }: { resort: Resort; data: Forecast & { past?: DailySeries; extended?: Forecast }; unit: string; mode: Mode; id?: string; pastDays?: number; period?: Period | null; archived?: boolean }) {
  const simple = mode === 'simple'
  const series = simple ? [weighted] : models
  const past = data.past && pastDays ? slicePeriod({ ...data.past, weights: data.weights }, data.past.dates.length - pastDays, data.past.dates.length) : undefined
  const pastLabel = pastDays ? pastPeriods.find(p => p[1] === pastDays)![0] : ''
  const future = period ? { ...slicePeriod(data.extended ?? data, period[1], period[2]), weights: data.weights } : undefined
  const sum = (future ?? past)!
  const shown = past && future ? { weights: data.weights, dates: [...past.dates, ...future.dates], daily: Object.fromEntries(Object.keys(future.daily).map(key => [key, [...past.daily[key], ...future.daily[key]]])) } : sum
  const split = past ? past.dates.length : 0
  const marker = period?.[1] === 0 ? '今天' : period?.[0] ?? ''
  const label = [past && pastLabel, period?.[0]].filter(Boolean).join(' + ')
  const sumLabel = `${future ? period![0] : pastLabel}累计`
  const totals = models.map(m => total(sum, m.id)).filter(n => n !== null)
  const range = (i: number) => {
    const s = spread(shown, 'snowfall_sum', i)
    return s ? `${snow(s.low, unit)}–${snow(s.high, unit)}` : '—'
  }
  const point = resort.points.find(p => p.id === data.query.pointId)!
  return <><p id={id} className="forecast-context">{resort.name} · {point.name} · 查询海拔 {data.query.elevation.toLocaleString('zh-CN')} m</p>{simple ? <dl className="model-totals simple" aria-label={`${label}加权降雪`}><div><dt><i style={{ background: weighted.color }} />{weighted.name}</dt><dd><strong>{snow(total(sum, weighted.id), unit)}</strong> {unit}<span>{sumLabel} · {totals.length > 1 ? `完整模型范围 ${snow(Math.min(...totals), unit)}–${snow(Math.max(...totals), unit)} ${unit}` : '完整模型不足两个，无范围'}</span>{past && sum !== past && <span>{pastLabel}累计 {snow(total(past, weighted.id), unit)} {unit}</span>}<span>权重 {weightLabel(data.weights)} · <a href="#settings">修改权重</a></span></dd></div></dl> : <dl className="model-totals" aria-label={`${label}预报降雪`}>{models.map(m => <div key={m.id}><dt><i style={{ background: m.color }} />{m.name}</dt><dd><strong>{snow(total(sum, m.id), unit)}</strong> {unit}<span>{sumLabel}{!sum.modelStatus[m.id].endsWith('完整') && ` · ${sum.modelStatus[m.id]}`}</span>{past && sum !== past && <span>{pastLabel}累计 {snow(total(past, m.id), unit)} {unit}</span>}</dd></div>)}</dl>}<div className="chart-heading"><h2>{archived ? '存档的七日降雪预报' : `${label}降雪`} <small>({unit})</small></h2><div className="legend">{series.map(m => <span key={m.id}><i style={{ background: m.color }} />{m.name}</span>)}</div></div><SnowChart data={shown} series={series} unit={unit} split={split} marker={marker} /><div className="table-scroll" tabIndex={0} role="region" aria-label="逐日明细，可横向滚动">{simple ? <table><thead><tr><th>日期</th><th>加权降雪 ({unit})</th><th>模型范围 ({unit})</th><th>阵风 (km/h)</th><th>温度 (°C)</th><th>缺失模型</th></tr></thead><tbody>{shown.dates.map((date, i) => <tr key={date} className={i < split ? 'past' : i === split && split > 0 ? 'today' : undefined}><td>{date.slice(5)}</td><td><strong>{snow(value(shown, 'snowfall_sum', weighted.id, i), unit)}</strong></td><td>{range(i)}</td><td>{fixed(value(shown, 'wind_gusts_10m_max', weighted.id, i))}</td><td>{fixed(value(shown, 'temperature_2m_min', weighted.id, i))} / {fixed(value(shown, 'temperature_2m_max', weighted.id, i))}</td><td>{missingModels(shown, i).join('、') || '无'}</td></tr>)}</tbody></table> : <table><thead><tr><th>日期</th>{models.map(m => <th key={m.id}>{m.name} ({unit})</th>)}<th>降雪范围 ({unit})</th>{models.map(m => <th key={`${m.id}-wind`}>{m.name} 阵风 (km/h)</th>)}{models.map(m => <th key={`${m.id}-temp`}>{m.name} 温度 (°C)</th>)}</tr></thead><tbody>{shown.dates.map((date, i) => <tr key={date} className={i < split ? 'past' : i === split && split > 0 ? 'today' : undefined}><td>{date.slice(5)}</td>{models.map(m => <td key={m.id}>{snow(value(shown, 'snowfall_sum', m.id, i), unit)}</td>)}<td>{range(i)}</td>{models.map(m => <td key={`${m.id}-wind`}>{value(shown, 'wind_gusts_10m_max', m.id, i) ?? '—'}</td>)}{models.map(m => <td key={`${m.id}-temp`}>{value(shown, 'temperature_2m_min', m.id, i) ?? '—'} / {value(shown, 'temperature_2m_max', m.id, i) ?? '—'}</td>)}</tr>)}</tbody></table>}</div><p className="muted footnote">— 表示缺失{period && period[2] > 7 && '。ICON 预报约 7.5 天，更远日期无数据；第 2 周仅供初筛。'}</p></>
}
