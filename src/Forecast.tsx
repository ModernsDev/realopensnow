import { useRef } from 'react'
import { fixed, missingModels, modes, resorts, models, snow, spread, total, value, weighted, weightLabel, type Mode, type Forecast, type ForecastWithReport } from './weather'

export function ModeSwitch({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return <div className="mode-switch" role="group" aria-label="预报模式">{(Object.keys(modes) as Mode[]).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{modes[m]}</button>)}</div>
}
export function Report({ data, unit, mode, inWorkspace = false }: { data: ForecastWithReport; unit: string; mode: Mode; inWorkspace?: boolean }) {
  const { report: summary, reportGenerated: generated } = data
  const details = useRef<HTMLDetailsElement>(null)
  if ('blocked' in summary) return <div className="report" role="status"><p>每日雪报暂不可用。{summary.blocked}</p><p><a href={data.source} target="_blank" rel="noreferrer">查看本批 Open-Meteo 请求</a> · 接收时间 <time dateTime={data.fetched}>{data.fetched}</time></p></div>
  const resort = resorts.find(r => r.id === data.query.resortId)!
  const point = resort.points.find(p => p.id === data.query.pointId)!
  const detailId = `forecast-${resort.id}-${point.id}`
  return <article className="report" aria-label={`${resort.name} 每日雪报`}>
    {inWorkspace && <h2>每日雪报</h2>}
    <p>{inWorkspace && `${resort.name} · `}{point.name} · 查询海拔 {data.query.elevation} m</p>
    <p className="muted">雪场当地 {data.dates[0]} · {data.timezone} · 以下为模型预报，实测降雪未接入。</p>
    {mode === 'simple' ? <>
      <p><strong>当日加权降雪</strong> · {snow(value(data, 'snowfall_sum', weighted.id, 0), unit)} {unit}</p>
      <p><strong>七日加权累计</strong> · {snow(total(data, weighted.id), unit)} {unit}（模型范围 {snow(summary.lowTotal, unit)}–{snow(summary.highTotal, unit)} {unit}）</p>
      <p><strong>当日加权阵风</strong> · {fixed(value(data, 'wind_gusts_10m_max', weighted.id, 0))} km/h</p>
      <p><strong>当日加权气温</strong> · {fixed(value(data, 'temperature_2m_min', weighted.id, 0))} 至 {fixed(value(data, 'temperature_2m_max', weighted.id, 0))} °C</p>
      <p className="muted">权重 {weightLabel}</p>
    </> : <>
    <p><strong>当日预报降雪</strong> · {summary.today.map(model => `${model.name} ${snow(model.snowfall, unit)} ${unit}`).join(' / ')}</p>
    <p><strong>七日模型分歧</strong> · {data.dates[0]} 至 {data.dates.at(-1)}，各模型累计预报降雪 {snow(summary.lowTotal, unit)}–{snow(summary.highTotal, unit)} {unit}（模型最小至最大值）</p>
    <p><strong>当日预报阵风</strong> · 各模型最高 {summary.gust} km/h</p>
    <p><strong>当日预报气温</strong> · 各模型最低至最高 {summary.lowTemp} 至 {summary.highTemp} °C</p>
    </>}
    <p className="muted">报告生成 <time dateTime={generated}>{generated}</time><br />预报接收 <time dateTime={data.fetched}>{data.fetched}</time></p>
    <p><a href={data.source} target="_blank" rel="noreferrer">来源 · 本批 Open-Meteo 请求</a> · <a href={`#${detailId}`} onClick={() => { if (details.current) details.current.open = true }}>查看本批预报明细</a></p>
    {!inWorkspace && <details id={detailId} ref={details}><summary>{mode === 'simple' ? '七日加权明细' : '七日各模型明细'}</summary><ForecastView data={data} unit={unit} mode={mode} /></details>}
  </article>
}
export function ForecastView({ data, unit, id, mode, archived = false }: { data: Forecast; unit: string; mode: Mode; id?: string; archived?: boolean }) {
  const simple = mode === 'simple'
  const series = simple ? [weighted] : models
  const totals = models.map(m => total(data, m.id)).filter(n => n !== null)
  const range = (i: number) => {
    const s = spread(data, 'snowfall_sum', i)
    return s ? `${snow(s.low, unit)}–${snow(s.high, unit)}` : '—'
  }
  const max = Math.max(1, ...series.flatMap(m => data.dates.map((_, i) => value(data, 'snowfall_sum', m.id, i) ?? 0)))
  const resort = resorts.find(r => r.id === data.query.resortId)!
  const point = resort.points.find(p => p.id === data.query.pointId)!
  return <><p id={id} className="forecast-context">{resort.name} · {point.name} · 查询海拔 {data.query.elevation.toLocaleString('zh-CN')} m</p>{simple ? <dl className="model-totals simple" aria-label="七日加权降雪"><div><dt><i style={{ background: weighted.color }} />{weighted.name}</dt><dd><strong>{snow(total(data, weighted.id), unit)}</strong> {unit}<span>七日累计 · {totals.length > 1 ? `完整模型范围 ${snow(Math.min(...totals), unit)}–${snow(Math.max(...totals), unit)} ${unit}` : '完整模型不足两个，无范围'}</span><span>权重 {weightLabel}</span></dd></div></dl> : <dl className="model-totals" aria-label="七日预报降雪">{models.map(m => <div key={m.id}><dt><i style={{ background: m.color }} />{m.name}</dt><dd><strong>{snow(total(data, m.id), unit)}</strong> {unit}<span>七日累计 · {data.modelStatus[m.id]}</span></dd></div>)}</dl>}<div className="chart-heading"><h2>{archived ? '存档的七日降雪预报' : '未来 7 天降雪'} <small>({unit})</small></h2><div className="legend">{series.map(m => <span key={m.id}><i style={{ background: m.color }} />{m.name}</span>)}</div></div><div className="chart-scroll" tabIndex={0} role="region" aria-label="七日降雪图，可横向滚动"><div className="chart" aria-label="七日降雪柱状图">{data.dates.map((date, i) => <div className="day" key={date}><div className="bars">{series.map(m => { const n = value(data, 'snowfall_sum', m.id, i); return <div className="bar-column" key={m.id}><span>{snow(n, unit)}</span><div title={`${date} ${m.name}: ${snow(n, unit)} ${unit}`} style={{ height: `${n === null ? 0 : n / max * 170}px`, minHeight: n === null ? 0 : undefined, background: m.color }} /></div> })}</div><span>{date.slice(5)}</span></div>)}</div></div><div className="table-scroll" tabIndex={0} role="region" aria-label="七日模型明细，可横向滚动">{simple ? <table><thead><tr><th>日期</th><th>加权降雪 ({unit})</th><th>模型范围 ({unit})</th><th>阵风 (km/h)</th><th>温度 (°C)</th><th>缺失模型</th></tr></thead><tbody>{data.dates.map((date, i) => <tr key={date}><td>{date.slice(5)}</td><td><strong>{snow(value(data, 'snowfall_sum', weighted.id, i), unit)}</strong></td><td>{range(i)}</td><td>{fixed(value(data, 'wind_gusts_10m_max', weighted.id, i))}</td><td>{fixed(value(data, 'temperature_2m_min', weighted.id, i))} / {fixed(value(data, 'temperature_2m_max', weighted.id, i))}</td><td>{missingModels(data, i).join('、') || '无'}</td></tr>)}</tbody></table> : <table><thead><tr><th>日期</th>{models.map(m => <th key={m.id}>{m.name} ({unit})</th>)}<th>降雪范围 ({unit})</th>{models.map(m => <th key={`${m.id}-wind`}>{m.name} 阵风 (km/h)</th>)}{models.map(m => <th key={`${m.id}-temp`}>{m.name} 温度 (°C)</th>)}</tr></thead><tbody>{data.dates.map((date, i) => <tr key={date}><td>{date.slice(5)}</td>{models.map(m => <td key={m.id}>{snow(value(data, 'snowfall_sum', m.id, i), unit)}</td>)}<td>{range(i)}</td>{models.map(m => <td key={`${m.id}-wind`}>{value(data, 'wind_gusts_10m_max', m.id, i) ?? '—'}</td>)}{models.map(m => <td key={`${m.id}-temp`}>{value(data, 'temperature_2m_min', m.id, i) ?? '—'} / {value(data, 'temperature_2m_max', m.id, i) ?? '—'}</td>)}</tr>)}</tbody></table>}</div><p className="muted footnote">{simple ? '加权综合按固定经验权重计算，未经实测校准；缺一模型时其余权重按比例放大，不足两个模型显示 —。' : '表格分别展示各模型风温；'}— 表示缺失，不等于零。海拔为查询点高度，不能代表整个雪场。</p><section className="catalog" aria-label="预报来源与覆盖"><h3>预报来源与覆盖</h3><p><a href={data.source} target="_blank" rel="noreferrer">Open-Meteo · 本批真实 API 请求</a> · ECMWF IFS 0.25° / GFS Seamless / ICON Seamless</p><p>请求时间 {data.requested} · 接收时间 {data.fetched}</p><p>覆盖 {data.dates[0]} 00:00 至 {data.dates.at(-1)} 当日结束 · {data.timezone} · 含今天的七个当地自然日</p><p>查询点 {data.query.lat}, {data.query.lon} · {data.query.elevation} m；API 网格中心 {data.grid.lat}, {data.grid.lon}</p><p>降雪/阵风按前一小时、温度按瞬时时刻汇总当地自然日，夏令时日可含 23/25 小时。降雪 cm / in，温度 °C，阵风 km/h。模型起报时间：接口未提供；获取时间不代表起报时间。</p></section></>
}
