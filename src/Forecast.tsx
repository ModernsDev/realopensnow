import { availableModels, missingModels, modes, models, snow, spread, total, value, weighted, weightLabel, defaultRange, rangeSeries, type DailySeries, type Mode, type Forecast, type ForecastWithReport, type Resort } from './weather'
import { elevation, temp, wind, type Units } from './units'

export function ModeSwitch({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return <div className="mode-switch" role="group" aria-label="预报模式">{(Object.keys(modes) as Mode[]).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{modes[m]}</button>)}</div>
}
export function Report({ resort, data, units, mode }: { resort: Resort; data: ForecastWithReport; units: Units; mode: Mode }) {
  const { report: summary } = data
  if ('blocked' in summary) return <div className="report" role="status"><p>每日雪报暂不可用。{summary.blocked}</p></div>
  const point = resort.points.find(p => p.id === data.query.pointId)!
  return <article className="report" aria-label={`${resort.name} 每日雪报`}>
    <h2>每日雪报</h2>
    <p>{resort.name} · {point.name} · 查询海拔 {elevation(data.query.elevation, units)} {units.elevation}</p>
    <p className="muted">{data.dates[0]}</p>
    {mode === 'simple' ? <>
      <p><strong>当日加权降雪</strong> · {snow(value(data, 'snowfall_sum', weighted.id, 0), units.snow)} {units.snow}</p>
      <p><strong>七日加权累计</strong> · {snow(total(data, weighted.id), units.snow)} {units.snow}（模型范围 {snow(summary.lowTotal, units.snow)}–{snow(summary.highTotal, units.snow)} {units.snow}）</p>
      <p><strong>当日加权阵风</strong> · {wind(value(data, 'wind_gusts_10m_max', weighted.id, 0), units)} {units.wind}</p>
      <p><strong>当日加权气温</strong> · {temp(value(data, 'temperature_2m_min', weighted.id, 0), units)} 至 {temp(value(data, 'temperature_2m_max', weighted.id, 0), units)} {units.temperature}</p>
      <p className="muted">权重 {weightLabel(data.weights)}</p>
    </> : <>
    <p><strong>当日预报降雪</strong> · {summary.today.map(model => `${model.name} ${snow(model.snowfall, units.snow)} ${units.snow}`).join(' / ')}</p>
    <p><strong>七日模型分歧</strong> · {data.dates[0]} 至 {data.dates.at(-1)}，各模型累计预报降雪 {snow(summary.lowTotal, units.snow)}–{snow(summary.highTotal, units.snow)} {units.snow}</p>
    <p><strong>当日预报阵风</strong> · 各模型最高 {wind(summary.gust, units)} {units.wind}</p>
    <p><strong>当日预报气温</strong> · 各模型最低至最高 {temp(summary.lowTemp, units)} 至 {temp(summary.highTemp, units)} {units.temperature}</p>
    </>}
    <p><a href={`#forecast-${resort.id}-${point.id}`}>预报明细</a></p>
  </article>
}
export function ReportTile({ resort, data, units, mode }: { resort: Resort; data: ForecastWithReport; units: Units; mode: Mode }) {
  const { report: summary } = data
  if ('blocked' in summary) return <p className="tile-status" role="status">{summary.blocked}</p>
  const point = resort.points.find(p => p.id === data.query.pointId)!
  const simple = mode === 'simple'
  const snows = summary.today.map(m => m.snowfall)
  const today = simple ? snow(value(data, 'snowfall_sum', weighted.id, 0), units.snow) : `${snow(Math.min(...snows), units.snow)}–${snow(Math.max(...snows), units.snow)}`
  const week = simple ? snow(total(data, weighted.id), units.snow) : `${snow(summary.lowTotal, units.snow)}–${snow(summary.highTotal, units.snow)}`
  const temps = simple ? `${temp(value(data, 'temperature_2m_min', weighted.id, 0), units)} ~ ${temp(value(data, 'temperature_2m_max', weighted.id, 0), units)}` : `${temp(summary.lowTemp, units)} ~ ${temp(summary.highTemp, units)}`
  const gust = simple ? wind(value(data, 'wind_gusts_10m_max', weighted.id, 0), units) : wind(summary.gust, units)
  return <>
    <p className="tile-meta">{point.name} · {elevation(data.query.elevation, units)} {units.elevation} · {data.dates[0]}</p>
    <p className="tile-snow"><b>{today}</b> {units.snow}<span>今日{simple ? '加权' : '模型范围'}</span></p>
    <dl className="tile-stats">
      <div><dt>7 天</dt><dd>{week} {units.snow}</dd></div>
      <div><dt>气温</dt><dd>{temps} {units.temperature}</dd></div>
      <div><dt>阵风</dt><dd>{gust} {units.wind}</dd></div>
    </dl>
  </>
}
type Series = { id: string; name: string; color: string }
function SnowChart({ data, series, units, split }: { data: DailySeries; series: Series[]; units: Units; split: number }) {
  const max = Math.max(1, ...series.flatMap(m => data.dates.map((_, i) => value(data, 'snowfall_sum', m.id, i) ?? 0)))
  const compact = series.length > 3
  return <div className="chart-scroll" tabIndex={0} role="region" aria-label="降雪图，可横向滚动"><div className={`chart days-${data.dates.length}`} aria-label="降雪柱状图">{data.dates.map((date, i) => <div className={`day${i < split ? ' past' : ''}${i === split && split > 0 ? ' today' : ''}`} key={date}>{i === split && split > 0 && <em>今天</em>}<div className={compact ? 'bars compact' : 'bars'}>{series.map(m => { const n = value(data, 'snowfall_sum', m.id, i); return compact && n === null ? null : <div className="bar-column" key={m.id}>{!compact && <span>{snow(n, units.snow)}</span>}<div title={`${date} ${m.name}: ${snow(n, units.snow)} ${units.snow}`} style={{ height: `${n === null ? 0 : n / max * 170}px`, minHeight: n === null ? 0 : undefined, background: m.color }} /></div> })}</div><span>{date.slice(5)}</span></div>)}</div></div>
}
export function ForecastView({ resort, data, units, id, mode, days = defaultRange, archived = false }: { resort: Resort; data: Forecast & { past?: DailySeries; extended?: Forecast }; units: Units; mode: Mode; id?: string; days?: [number, number]; archived?: boolean }) {
  const simple = mode === 'simple'
  const all = data.extended ?? data
  const snowModels = availableModels(all, 'snowfall_sum')
  const gustModels = availableModels(all, 'wind_gusts_10m_max')
  const tempModels = availableModels(all, 'temperature_2m_min')
  const series = simple ? [weighted] : snowModels
  const { past, future } = rangeSeries(data, ...days)
  const sum = (future ?? past)!
  const shown = past && future ? { weights: data.weights, dates: [...past.dates, ...future.dates], daily: Object.fromEntries(Object.keys(future.daily).map(key => [key, [...past.daily[key], ...future.daily[key]]])) } : sum
  const split = past ? past.dates.length : 0
  const label = `${shown.dates[0].slice(5)}${shown.dates.length > 1 ? ` 至 ${shown.dates.at(-1)!.slice(5)} ` : ' '}`
  const sumLabel = future ? `${past ? '未来 ' : ''}${future.dates.length} 天预报累计` : `过去 ${past!.dates.length} 天累计`
  const totals = models.map(m => total(sum, m.id)).filter(n => n !== null)
  const range = (i: number) => {
    const s = spread(shown, 'snowfall_sum', i)
    return s ? `${snow(s.low, units.snow)}–${snow(s.high, units.snow)}` : '—'
  }
  const point = resort.points.find(p => p.id === data.query.pointId)!
  return <><p id={id} className="forecast-context">{resort.name} · {point.name} · 查询海拔 {elevation(data.query.elevation, units)} {units.elevation}</p>{simple ? <dl className="model-totals simple" aria-label={`${label}加权降雪`}><div><dt><i style={{ background: weighted.color }} />{weighted.name}</dt><dd><strong>{snow(total(sum, weighted.id), units.snow)}</strong> {units.snow}<span>{sumLabel}</span><span>{totals.length > 1 ? `模型范围 ${snow(Math.min(...totals), units.snow)}–${snow(Math.max(...totals), units.snow)} ${units.snow}` : '完整模型不足两个，无范围'}</span>{past && sum !== past && <span>过去 {past.dates.length} 天累计 {snow(total(past, weighted.id), units.snow)} {units.snow}</span>}</dd></div></dl> : <dl className="model-totals" aria-label={`${label}预报降雪`}>{snowModels.map(m => <div key={m.id}><dt><i style={{ background: m.color }} />{m.name}</dt><dd><strong>{snow(total(sum, m.id), units.snow)}</strong> {units.snow}<span>{sumLabel}{sum === future && !future.modelStatus[m.id].endsWith('完整') && ` · ${future.modelStatus[m.id]}`}</span>{past && sum !== past && <span>过去 {past.dates.length} 天累计 {snow(total(past, m.id), units.snow)} {units.snow}</span>}</dd></div>)}</dl>}<div className="chart-heading"><h2>{archived ? '存档的七日降雪预报' : `${label}降雪`} <small>({units.snow})</small></h2><div className="legend">{series.map(m => <span key={m.id}><i style={{ background: m.color }} />{m.name}</span>)}</div></div><SnowChart data={shown} series={series} units={units} split={split} /><div className="table-scroll" tabIndex={0} role="region" aria-label="逐日明细，可横向滚动">{simple ? <table><thead><tr><th>日期</th><th>加权降雪 ({units.snow})</th><th>模型范围 ({units.snow})</th><th>阵风 ({units.wind})</th><th>温度 ({units.temperature})</th><th>缺失模型</th></tr></thead><tbody>{shown.dates.map((date, i) => <tr key={date} className={i < split ? 'past' : i === split && split > 0 ? 'today' : undefined}><td>{date.slice(5)}</td><td><strong>{snow(value(shown, 'snowfall_sum', weighted.id, i), units.snow)}</strong></td><td>{range(i)}</td><td>{wind(value(shown, 'wind_gusts_10m_max', weighted.id, i), units)}</td><td>{temp(value(shown, 'temperature_2m_min', weighted.id, i), units)} / {temp(value(shown, 'temperature_2m_max', weighted.id, i), units)}</td><td>{missingModels(shown, i).join('、') || '无'}</td></tr>)}</tbody></table> : <table><thead><tr><th>日期</th>{snowModels.map(m => <th key={m.id}>{m.name} ({units.snow})</th>)}<th>降雪范围 ({units.snow})</th>{gustModels.map(m => <th key={`${m.id}-wind`}>{m.name} 阵风 ({units.wind})</th>)}{tempModels.map(m => <th key={`${m.id}-temp`}>{m.name} 温度 ({units.temperature})</th>)}</tr></thead><tbody>{shown.dates.map((date, i) => <tr key={date} className={i < split ? 'past' : i === split && split > 0 ? 'today' : undefined}><td>{date.slice(5)}</td>{snowModels.map(m => <td key={m.id}>{snow(value(shown, 'snowfall_sum', m.id, i), units.snow)}</td>)}<td>{range(i)}</td>{gustModels.map(m => <td key={`${m.id}-wind`}>{wind(value(shown, 'wind_gusts_10m_max', m.id, i), units)}</td>)}{tempModels.map(m => <td key={`${m.id}-temp`}>{temp(value(shown, 'temperature_2m_min', m.id, i), units)} / {temp(value(shown, 'temperature_2m_max', m.id, i), units)}</td>)}</tr>)}</tbody></table>}</div><p className="muted footnote">— 表示缺失{days[1] > 7 && '。ICON 预报约 7.5 天，更远日期无数据；第 2 周仅供初筛。'}</p></>
}
