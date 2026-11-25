import { useRef } from 'react'
import { resorts, models, snow, total, value, type Forecast, type ForecastWithReport } from './weather'

export function Report({ data, unit, inWorkspace = false }: { data: ForecastWithReport; unit: string; inWorkspace?: boolean }) {
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
    <p><strong>当日预报降雪</strong> · {summary.today.map(model => `${model.name} ${snow(model.snowfall, unit)} ${unit}`).join(' / ')}</p>
    <p><strong>七日模型分歧</strong> · {data.dates[0]} 至 {data.dates.at(-1)}，各模型累计预报降雪 {snow(summary.lowTotal, unit)}–{snow(summary.highTotal, unit)} {unit}（模型最小至最大值）</p>
    <p><strong>当日预报阵风</strong> · 各模型最高 {summary.gust} km/h</p>
    <p><strong>当日预报气温</strong> · 各模型最低至最高 {summary.lowTemp} 至 {summary.highTemp} °C</p>
    <p className="muted">报告生成 <time dateTime={generated}>{generated}</time><br />预报接收 <time dateTime={data.fetched}>{data.fetched}</time></p>
    <p><a href={data.source} target="_blank" rel="noreferrer">来源 · 本批 Open-Meteo 请求</a> · <a href={`#${detailId}`} onClick={() => { if (details.current) details.current.open = true }}>查看本批预报明细</a></p>
    {!inWorkspace && <details id={detailId} ref={details}><summary>七日各模型明细</summary><ForecastView data={data} unit={unit} /></details>}
  </article>
}
export function ForecastView({ data, unit, id, period = '未来 7 天', archived = false }: { data: Forecast; unit: string; id?: string; period?: string; archived?: boolean }) {
  const max = Math.max(1, ...models.flatMap(m => data.dates.map((_, i) => value(data, 'snowfall_sum', m.id, i) ?? 0)))
  const resort = resorts.find(r => r.id === data.query.resortId)!
  const point = resort.points.find(p => p.id === data.query.pointId)!
  return <><p id={id} className="forecast-context">{resort.name} · {point.name} · 查询海拔 {data.query.elevation.toLocaleString('zh-CN')} m</p><dl className="model-totals" aria-label={`${period}预报降雪`}>{models.map(m => <div key={m.id}><dt><i style={{ background: m.color }} />{m.name}</dt><dd><strong>{snow(total(data, m.id), unit)}</strong> {unit}<span>{data.dates.length} 日累计 · {data.modelStatus[m.id]}</span></dd></div>)}</dl><div className="chart-heading"><h2>{archived ? '存档的七日降雪预报' : `${period}降雪`} <small>({unit})</small></h2><div className="legend">{models.map(m => <span key={m.id}><i style={{ background: m.color }} />{m.name}</span>)}</div></div><div className="chart-scroll" tabIndex={0} role="region" aria-label="降雪图，可横向滚动"><div className={`chart${data.dates.length > 7 ? ' chart-long' : ''}`} aria-label="各模型降雪柱状图">{data.dates.map((date, i) => <div className="day" key={date}><div className="bars">{models.map(m => { const n = value(data, 'snowfall_sum', m.id, i); return <div className="bar-column" key={m.id}><span>{snow(n, unit)}</span><div title={`${date} ${m.name}: ${snow(n, unit)} ${unit}`} style={{ height: `${n === null ? 0 : n / max * 170}px`, minHeight: n === null ? 0 : undefined, background: m.color }} /></div> })}</div><span>{date.slice(5)}</span></div>)}</div></div><div className="table-scroll" tabIndex={0} role="region" aria-label="模型明细，可横向滚动"><table><thead><tr><th>日期</th>{models.map(m => <th key={m.id}>{m.name} ({unit})</th>)}{models.map(m => <th key={`${m.id}-wind`}>{m.name} 阵风 (km/h)</th>)}{models.map(m => <th key={`${m.id}-temp`}>{m.name} 温度 (°C)</th>)}</tr></thead><tbody>{data.dates.map((date, i) => <tr key={date}><td>{date.slice(5)}</td>{models.map(m => <td key={m.id}>{snow(value(data, 'snowfall_sum', m.id, i), unit)}</td>)}{models.map(m => <td key={`${m.id}-wind`}>{value(data, 'wind_gusts_10m_max', m.id, i) ?? '—'}</td>)}{models.map(m => <td key={`${m.id}-temp`}>{value(data, 'temperature_2m_min', m.id, i) ?? '—'} / {value(data, 'temperature_2m_max', m.id, i) ?? '—'}</td>)}</tr>)}</tbody></table></div><p className="muted footnote">表格分别展示各模型风温；— 表示缺失，不等于零。{period.includes('14') && 'ICON 预报约 7.5 天，更远日期无数据；第 2 周仅供初筛。'}海拔为查询点高度，不能代表整个雪场。</p><section className="catalog" aria-label="预报来源与覆盖"><h3>预报来源与覆盖</h3><p><a href={data.source} target="_blank" rel="noreferrer">Open-Meteo · 本批真实 API 请求</a> · ECMWF IFS 0.25° / GFS Seamless / ICON Seamless</p><p>请求时间 {data.requested} · 接收时间 {data.fetched}</p><p>覆盖 {data.dates[0]} 00:00 至 {data.dates.at(-1)} 当日结束 · {data.timezone} · {data.dates.length} 个当地自然日</p><p>查询点 {data.query.lat}, {data.query.lon} · {data.query.elevation} m；API 网格中心 {data.grid.lat}, {data.grid.lon}</p><p>降雪/阵风按前一小时、温度按瞬时时刻汇总当地自然日，夏令时日可含 23/25 小时。降雪 cm / in，温度 °C，阵风 km/h。模型起报时间：接口未提供；获取时间不代表起报时间。</p></section></>
}
