import { availableModels, fixed, missingModels, modes, models, snow, spread, total, value, weighted, weightLabel, defaultRange, rangeSeries, type DailySeries, type Mode, type Forecast, type ForecastWithReport, type Resort } from './weather'

export function ModeSwitch({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return <div className="mode-switch" role="group" aria-label="预报模式">{(Object.keys(modes) as Mode[]).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{modes[m]}</button>)}</div>
}
export function Report({ resort, data, unit, mode }: { resort: Resort; data: ForecastWithReport; unit: string; mode: Mode }) {
  const { report: summary } = data
  if ('blocked' in summary) return <div className="report" role="status"><p>每日雪报暂不可用。{summary.blocked}</p></div>
  const point = resort.points.find(p => p.id === data.query.pointId)!
  return <article className="report" aria-label={`${resort.name} 每日雪报`}>
    <h2>每日雪报</h2>
    <p>{resort.name} · {point.name} · 查询海拔 {data.query.elevation} m</p>
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
    <p><a href={`#forecast-${resort.id}-${point.id}`}>预报明细</a></p>
  </article>
}
export function ReportTile({ resort, data, unit, mode }: { resort: Resort; data: ForecastWithReport; unit: string; mode: Mode }) {
  const { report: summary } = data
  if ('blocked' in summary) return <p className="tile-status" role="status">{summary.blocked}</p>
  const point = resort.points.find(p => p.id === data.query.pointId)!
  const simple = mode === 'simple'
  const snows = summary.today.map(m => m.snowfall)
  const today = simple ? snow(value(data, 'snowfall_sum', weighted.id, 0), unit) : `${snow(Math.min(...snows), unit)}–${snow(Math.max(...snows), unit)}`
  const week = simple ? snow(total(data, weighted.id), unit) : `${snow(summary.lowTotal, unit)}–${snow(summary.highTotal, unit)}`
  const temps = simple ? `${fixed(value(data, 'temperature_2m_min', weighted.id, 0))} ~ ${fixed(value(data, 'temperature_2m_max', weighted.id, 0))}` : `${summary.lowTemp} ~ ${summary.highTemp}`
  const gust = simple ? fixed(value(data, 'wind_gusts_10m_max', weighted.id, 0)) : summary.gust
  return <>
    <p className="tile-meta">{point.name} · {data.query.elevation} m · {data.dates[0]}</p>
    <p className="tile-snow"><b>{today}</b> {unit}<span>今日{simple ? '加权' : '模型范围'}</span></p>
    <dl className="tile-stats">
      <div><dt>7 天</dt><dd>{week} {unit}</dd></div>
      <div><dt>气温</dt><dd>{temps} °C</dd></div>
      <div><dt>阵风</dt><dd>{gust} km/h</dd></div>
    </dl>
  </>
}
type Series = { id: string; name: string; color: string }
function SnowChart({ data, series, unit, split }: { data: DailySeries; series: Series[]; unit: string; split: number }) {
  const max = Math.max(1, ...series.flatMap(m => data.dates.map((_, i) => value(data, 'snowfall_sum', m.id, i) ?? 0)))
  const compact = series.length > 3
  return <div className="chart-scroll" tabIndex={0} role="region" aria-label="降雪图，可横向滚动"><div className={`chart days-${data.dates.length}`} aria-label="降雪柱状图">{data.dates.map((date, i) => <div className={`day${i < split ? ' past' : ''}${i === split && split > 0 ? ' today' : ''}`} key={date}>{i === split && split > 0 && <em>今天</em>}<div className={compact ? 'bars compact' : 'bars'}>{series.map(m => { const n = value(data, 'snowfall_sum', m.id, i); return compact && n === null ? null : <div className="bar-column" key={m.id}>{!compact && <span>{snow(n, unit)}</span>}<div title={`${date} ${m.name}: ${snow(n, unit)} ${unit}`} style={{ height: `${n === null ? 0 : n / max * 170}px`, minHeight: n === null ? 0 : undefined, background: m.color }} /></div> })}</div><span>{date.slice(5)}</span></div>)}</div></div>
}
export function ForecastView({ resort, data, unit, id, mode, days = defaultRange, archived = false }: { resort: Resort; data: Forecast & { past?: DailySeries; extended?: Forecast }; unit: string; mode: Mode; id?: string; days?: [number, number]; archived?: boolean }) {
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
    return s ? `${snow(s.low, unit)}–${snow(s.high, unit)}` : '—'
  }
  const point = resort.points.find(p => p.id === data.query.pointId)!
  return <><p id={id} className="forecast-context">{resort.name} · {point.name} · 查询海拔 {data.query.elevation.toLocaleString('zh-CN')} m</p>{simple ? <dl className="model-totals simple" aria-label={`${label}加权降雪`}><div><dt><i style={{ background: weighted.color }} />{weighted.name}</dt><dd><strong>{snow(total(sum, weighted.id), unit)}</strong> {unit}<span>{sumLabel} · {totals.length > 1 ? `完整模型范围 ${snow(Math.min(...totals), unit)}–${snow(Math.max(...totals), unit)} ${unit}` : '完整模型不足两个，无范围'}</span>{past && sum !== past && <span>过去 {past.dates.length} 天累计 {snow(total(past, weighted.id), unit)} {unit}</span>}<span>权重 {weightLabel(data.weights)} · <a href="#settings">修改权重</a></span></dd></div></dl> : <dl className="model-totals" aria-label={`${label}预报降雪`}>{snowModels.map(m => <div key={m.id}><dt><i style={{ background: m.color }} />{m.name}</dt><dd><strong>{snow(total(sum, m.id), unit)}</strong> {unit}<span>{sumLabel}{sum === future && !future.modelStatus[m.id].endsWith('完整') && ` · ${future.modelStatus[m.id]}`}</span>{past && sum !== past && <span>过去 {past.dates.length} 天累计 {snow(total(past, m.id), unit)} {unit}</span>}</dd></div>)}</dl>}<div className="chart-heading"><h2>{archived ? '存档的七日降雪预报' : `${label}降雪`} <small>({unit})</small></h2><div className="legend">{series.map(m => <span key={m.id}><i style={{ background: m.color }} />{m.name}</span>)}</div></div><SnowChart data={shown} series={series} unit={unit} split={split} /><div className="table-scroll" tabIndex={0} role="region" aria-label="逐日明细，可横向滚动">{simple ? <table><thead><tr><th>日期</th><th>加权降雪 ({unit})</th><th>模型范围 ({unit})</th><th>阵风 (km/h)</th><th>温度 (°C)</th><th>缺失模型</th></tr></thead><tbody>{shown.dates.map((date, i) => <tr key={date} className={i < split ? 'past' : i === split && split > 0 ? 'today' : undefined}><td>{date.slice(5)}</td><td><strong>{snow(value(shown, 'snowfall_sum', weighted.id, i), unit)}</strong></td><td>{range(i)}</td><td>{fixed(value(shown, 'wind_gusts_10m_max', weighted.id, i))}</td><td>{fixed(value(shown, 'temperature_2m_min', weighted.id, i))} / {fixed(value(shown, 'temperature_2m_max', weighted.id, i))}</td><td>{missingModels(shown, i).join('、') || '无'}</td></tr>)}</tbody></table> : <table><thead><tr><th>日期</th>{snowModels.map(m => <th key={m.id}>{m.name} ({unit})</th>)}<th>降雪范围 ({unit})</th>{gustModels.map(m => <th key={`${m.id}-wind`}>{m.name} 阵风 (km/h)</th>)}{tempModels.map(m => <th key={`${m.id}-temp`}>{m.name} 温度 (°C)</th>)}</tr></thead><tbody>{shown.dates.map((date, i) => <tr key={date} className={i < split ? 'past' : i === split && split > 0 ? 'today' : undefined}><td>{date.slice(5)}</td>{snowModels.map(m => <td key={m.id}>{snow(value(shown, 'snowfall_sum', m.id, i), unit)}</td>)}<td>{range(i)}</td>{gustModels.map(m => <td key={`${m.id}-wind`}>{value(shown, 'wind_gusts_10m_max', m.id, i) ?? '—'}</td>)}{tempModels.map(m => <td key={`${m.id}-temp`}>{value(shown, 'temperature_2m_min', m.id, i) ?? '—'} / {value(shown, 'temperature_2m_max', m.id, i) ?? '—'}</td>)}</tr>)}</tbody></table>}</div><p className="muted footnote">— 表示缺失{days[1] > 7 && '。ICON 预报约 7.5 天，更远日期无数据；第 2 周仅供初筛。'}</p></>
}
