import { en, t } from './i18n'
import { availableModels, type PeriodSeries, type DayPart, visibleModels, modes, snow, snowAgreement, spread, total, totalAgreement, value, type Agreement, agreementNames, agreementNote, weighted, defaultRange, offsetLabel, rangeSeries, type DailySeries, type Mode, type Forecast, type ForecastWithReport, type Resort } from './weather'
import { useState, type CSSProperties } from 'react'
import { elevation, temp, wind, type Units } from './units'
import { TimelinePicker } from './PeriodPicker'
import { snowGrades, snowLevel, snowQuality, type SnowGrade } from './snowQuality'
const statuses: Record<string, string> = { 数据完整: 'complete', 部分缺失: 'partly missing', 不可用: 'unavailable' }
const statusLabel = (s: string) => en ? statuses[s] ?? s : s

function Grade({ data, i, wetLabel = t('前日偏湿', 'wet day before') }: { data: DailySeries; i: number; wetLabel?: string }) {
  const { grade, wetBefore } = snowQuality(data, i)
  return <span className={`grade grade-${grade}`} title={snowGrades[grade].rule}>{snowGrades[grade].name}{wetBefore && (grade === 'light' || grade === 'good') && <small> · {wetLabel}</small>}</span>
}
function SnowLevel({ data, i, point, units }: { data: DailySeries; i: number; point: number; units: Units }) {
  const s = snowLevel(data, i)
  if (!s) return <>—</>
  return <>{elevation(s.low, units)}–{elevation(s.high, units)} <small>{s.high < point ? t('低于查询点', 'below point') : s.low > point ? t('高于查询点', 'above point') : t('跨越查询点', 'spans point')}</small></>
}
function GradeRules() {
  return <details className="grade-rules"><summary>{t('雪质与雪线怎么判定', 'How snow quality and snow level work')}</summary><dl>{(Object.keys(snowGrades) as SnowGrade[]).map(g => <div key={g}><dt><span className={`grade grade-${g}`}>{snowGrades[g].name}</span></dt><dd>{snowGrades[g].rule}</dd></div>)}</dl><p>{t('按加权降雪、降雨和气温高于 −1 °C 时的降雪比例估算，不是实测雪况。「前日偏湿」表示前一天为湿雪或雨，新雪下可能有硬壳。雪线取冰冻层高度减 300 m，只有 GFS、ICON、HRRR 等提供冰冻层的模型参与，ECMWF 不提供。', 'Estimated from weighted snowfall, rain and the share of snow falling above −1 °C; not measured surface conditions. "Wet day before" means the previous day was wet snow or rain, so there may be a crust under new snow. Snow level is the freezing level minus 300 m, using only models that provide a freezing level (GFS, ICON, HRRR and similar); ECMWF does not.')}</p></details>
}

export function AgreementTag({ a }: { a: Agreement | null }) {
  if (!a) return <span className="agreement" title={agreementNote}>{t('模型不足两个', 'Under 2 models')}</span>
  return <span className={`agreement agreement-${a.level}`} title={agreementNote}>{agreementNames[a.level]} · {t(`${a.count} 个模型`, `${a.count} models`)}</span>
}
export function ModeSwitch({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return <div className="mode-switch" role="group" aria-label={t('预报模式', 'Forecast mode')}>{(Object.keys(modes) as Mode[]).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{modes[m]}</button>)}</div>
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
    <p className="tile-snow"><b>{today}</b> {units.snow}<span>{simple ? t('今日加权', 'Today, weighted') : t('今日模型范围', 'Today, model range')}</span><AgreementTag a={snowAgreement(data, 0)} /></p>
    <dl className="tile-stats">
      <div><dt>{t('7 天', '7 days')}</dt><dd>{week} {units.snow} <AgreementTag a={totalAgreement(data)} /></dd></div>
      <div><dt>{t('气温', 'Temp')}</dt><dd>{temps} {units.temperature}</dd></div>
      <div><dt>{t('阵风', 'Gusts')}</dt><dd>{gust} {units.wind}</dd></div>
      <div><dt>{t('雪质', 'Snow')}</dt><dd><Grade data={data} i={0} /></dd></div>
    </dl>
  </>
}
export function SnowTotals({ data, days, units }: { data: Forecast & { past?: DailySeries; extended?: Forecast }; days: [number, number]; units: Units }) {
  const { past, future } = rangeSeries(data, ...days)
  const sum = (future ?? past)!
  const totals = visibleModels(data).map(m => total(sum, m.id)).filter(n => n !== null)
  const u = units.snow
  return <>
    <div><dt>{future ? t(`${past ? '未来 ' : ''}${future.dates.length} 天加权预报`, `${past ? 'Next ' : ''}${future.dates.length}-day weighted forecast`) : t(`过去 ${past!.dates.length} 天加权累计`, `Past ${past!.dates.length}-day weighted total`)}</dt><dd><strong>{snow(total(sum, weighted.id), u)} {u}</strong><span>{totals.length > 1 ? `${t('模型范围', 'Model range')} ${snow(Math.min(...totals), u)}–${snow(Math.max(...totals), u)} ${u}` : t('完整模型不足两个，无范围', 'Fewer than two complete models; no range')}</span></dd></div>
    {past && sum !== past && <div><dt>{t(`过去 ${past.dates.length} 天加权累计`, `Past ${past.dates.length}-day weighted total`)}</dt><dd><strong>{snow(total(past, weighted.id), u)} {u}</strong></dd></div>}
  </>
}
type Series = { id: string; name: string; color: string }
const parts: DayPart[] = ['day', 'night']
const partName = { day: t('白天', 'Day'), night: t('夜间', 'Night') }
type Row = { key: string; date: string; part?: DayPart; f: DailySeries; j: number; className?: string; past: boolean }
const periodIndex = (f: PeriodSeries, date: string, part: DayPart) => f.dates.indexOf(`${date}-${part}`)
const gradeColors: Record<SnowGrade, string> = { unknown: '#c9d2da', none: '#c9d2da', light: '#9cc0ef', good: '#3d7fe0', excellent: '#1d4fa8', wet: '#8a5cc4', rain: '#e08a2e' }
type Tip = { x: number; y: number; f: DailySeries; j: number; label: string; past: boolean }
function ChartTip({ tip, units }: { tip: Tip; units: Units }) {
  const { f, j } = tip
  const grade = snowQuality(f, j).grade
  const rows = visibleModels(f).flatMap(m => { const n = value(f, 'snowfall_sum', m.id, j); return n === null ? [] : [{ ...m, n }] })
  const left = tip.x + 240 > window.innerWidth ? tip.x - 236 : tip.x + 14
  return <div className="chart-tip" role="tooltip" style={{ left, top: Math.max(8, Math.min(tip.y + 14, window.innerHeight - rows.length * 18 - 120)) }}>
    <strong>{tip.label}</strong>
    <p>{t('加权', 'Weighted')} {snow(value(f, 'snowfall_sum', weighted.id, j), units.snow)} {units.snow} · <span className={`grade grade-${grade}`}>{snowGrades[grade].name}</span></p>
    {!tip.past && <p><AgreementTag a={snowAgreement(f, j)} /></p>}
    <dl>{rows.map(m => <div key={m.id}><dt><i style={{ background: m.color }} />{m.name}</dt><dd>{snow(m.n, units.snow)} {units.snow}</dd></div>)}</dl>
    {!rows.length && <p>{t('无模型数据', 'No model data')}</p>}
  </div>
}
function SnowChart({ data, periods, series, units, split, simple }: { data: DailySeries; periods?: PeriodSeries; series: Series[]; units: Units; split: number; simple: boolean }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const cells = (date: string, i: number) => periods ? parts.map(part => ({ part, f: periods, j: periodIndex(periods, date, part) })) : [{ part: undefined, f: data, j: i }]
  const ranges = data.dates.flatMap((date, i) => i < split ? [] : cells(date, i).map(({ f, j }) => spread(f, 'snowfall_sum', j)?.high ?? 0))
  const max = Math.max(1, ...(simple ? ranges : []), ...series.flatMap(m => data.dates.flatMap((date, i) => cells(date, i).map(({ f, j }) => value(f, 'snowfall_sum', m.id, j) ?? 0))))
  const compact = series.length * (periods ? 2 : 1) > 3
  const h = (n: number) => n / max * 170
  const simpleBar = (date: string, i: number, part: DayPart | undefined, f: DailySeries, j: number) => {
    const n = value(f, 'snowfall_sum', weighted.id, j)
    const past = i < split
    const label = `${date}${part ? ` ${partName[part]}` : ''}`
    const range = past ? null : spread(f, 'snowfall_sum', j)
    const a = past ? null : snowAgreement(f, j)
    const bar = n === null ? 0 : h(n)
    const show = (x: number, y: number) => setTip({ x, y, f, j, label, past })
    return <div className={`bar-column${part ? ` ${part}` : ''}`} key={`${part}-simple`} tabIndex={0} aria-label={`${label}: ${snow(n, units.snow)} ${units.snow}`} onMouseMove={e => show(e.clientX, e.clientY)} onMouseLeave={() => setTip(null)} onFocus={e => { const r = e.currentTarget.getBoundingClientRect(); show(r.right, r.top) }} onBlur={() => setTip(null)}>
      <span>{snow(n, units.snow)}</span>
      <div className="bar-stack" style={{ height: `${Math.max(bar, range ? h(range.high) : 0)}px` }}>
        <div className={`bar${a ? ` hatch-${a.level}` : ''}`} style={{ height: `${bar}px`, minHeight: n === null ? 0 : 1, background: gradeColors[snowQuality(f, j).grade] }} />
        {range && range.high > range.low && <i className={`whisker${a?.level === 'uncertain' ? ' uncertain' : ''}`} style={{ bottom: `${h(range.low)}px`, height: `${h(range.high - range.low)}px` }} />}
      </div>
    </div>
  }
  return <div className="chart-scroll" tabIndex={0} role="region" aria-label={t('降雪图，可横向滚动', 'Snowfall chart, scrolls horizontally')} onScroll={() => setTip(null)}><div className={`chart${data.dates.length > 10 ? ' long' : ''}${periods ? ' split' : ''}`} style={{ '--days': data.dates.length } as CSSProperties} aria-label={t('降雪柱状图', 'Snowfall bar chart')}>{data.dates.map((date, i) => <div className={`day${i < split ? ' past' : ''}${i === split && split > 0 ? ' today' : ''}`} key={date}>{i === split && split > 0 && <em>{t('今天', 'Today')}</em>}<div className={compact ? 'bars compact' : 'bars'}>{cells(date, i).flatMap(({ part, f, j }) => simple ? [simpleBar(date, i, part, f, j)] : series.map(m => { const n = value(f, 'snowfall_sum', m.id, j); const name = part ? `${partName[part]} ` : ''; return compact && n === null ? null : <div className={`bar-column${part ? ` ${part}` : ''}`} key={`${part}-${m.id}`}>{!compact && <span>{snow(n, units.snow)}</span>}<div title={`${date} ${name}${m.name}: ${snow(n, units.snow)} ${units.snow}`} style={{ height: `${n === null ? 0 : n / max * 170}px`, minHeight: n === null ? 0 : undefined, background: m.color }} /></div> }))}</div><span>{date.slice(5)}</span></div>)}</div>{tip && <ChartTip tip={tip} units={units} />}</div>
}
function SimpleLegend() {
  const grades: SnowGrade[] = ['light', 'good', 'excellent', 'wet', 'rain', 'none']
  return <dl className="simple-legend">
    <div><dt>{t('颜色 · 雪质', 'Colour · snow quality')}</dt><dd>{grades.map(g => <span key={g}><i style={{ background: gradeColors[g] }} />{snowGrades[g].name}</span>)}</dd></div>
    <div><dt>{t('纹理 · 模型一致性', 'Pattern · model agreement')}</dt><dd><span><i style={{ background: gradeColors.good }} />{t('一致', 'Agree')}</span><span><i className="hatch-split" style={{ background: gradeColors.good }} />{t('有分歧', 'Mixed')}</span><span><i className="hatch-wide" style={{ background: gradeColors.good }} />{t('严重分歧', 'Wide split')}</span></dd></div>
    <div><dt>{t('竖线 · 模型范围', 'Line · model range')}</dt><dd><span><b className="whisker-key" />{t('各模型预报的最低到最高值', 'Lowest to highest model forecast')}</span><span><b className="whisker-key uncertain" />{t('降雪不确定：多数模型无雪，但有模型报 ≥ 1 cm', 'Snow uncertain: most models show no snow, but at least one shows ≥ 1 cm')}</span></dd></div>
  </dl>
}
export function ForecastView({ data, units, id, mode, days = defaultRange, onDays, archived = false }: { data: Forecast & { past?: DailySeries; extended?: Forecast; periods?: PeriodSeries }; units: Units; mode: Mode; id?: string; days?: [number, number]; onDays?: (days: [number, number]) => void; archived?: boolean }) {
  const simple = mode === 'simple'
  const all = data.extended ?? data
  const snowModels = availableModels(all, 'snowfall_sum')
  const gustModels = availableModels(all, 'wind_gusts_10m_max')
  const tempModels = availableModels(all, 'temperature_2m_min')
  const series = simple ? [weighted] : snowModels
  const { past, future } = rangeSeries(data, ...days)
  const sum = (future ?? past)!
  const shown = past && future ? { weights: data.weights, hidden: data.hidden, dates: [...past.dates, ...future.dates], daily: Object.fromEntries(Object.keys(future.daily).map(key => [key, [...past.daily[key], ...future.daily[key]]])) } : sum
  const split = past ? past.dates.length : 0
  const label = `${shown.dates[0].slice(5)}${shown.dates.length > 1 ? ` ${t('至', '–')} ${shown.dates.at(-1)!.slice(5)} ` : ' '}`
  const sumLabel = future ? t(`${past ? '未来 ' : ''}${future.dates.length} 天预报累计`, `${past ? 'Next ' : ''}${future.dates.length}-day forecast total`) : t(`过去 ${past!.dates.length} 天累计`, `Past ${past!.dates.length}-day total`)
  const periods = data.periods && shown.dates.every(date => periodIndex(data.periods!, date, 'day') >= 0) ? data.periods : undefined
  const rows = shown.dates.flatMap((date, i): Row[] => {
    const className = i < split ? 'past' : i === split && split > 0 ? 'today' : undefined
    return periods ? parts.map(part => ({ key: `${date}-${part}`, date, part, f: periods, j: periodIndex(periods, date, part), className: part === 'night' ? className?.replace('today', '') || undefined : className, past: i < split })) : [{ key: date, date, f: shown, j: i, className, past: i < split }]
  })
  const range = (f: DailySeries, j: number) => {
    const s = spread(f, 'snowfall_sum', j)
    return s ? `${snow(s.low, units.snow)}–${snow(s.high, units.snow)}` : '—'
  }
  const dateCell = (row: Row) => row.part === 'night' ? null : <td rowSpan={row.part ? 2 : undefined}>{row.date.slice(5)}</td>
  const partCell = (row: Row) => row.part && <td className="part">{partName[row.part]}</td>
  const wetLabel = periods ? t('前一时段偏湿', 'wet period before') : undefined
  const dateHead = <><th>{t('日期', 'Date')}</th>{periods && <th>{t('时段', 'Period')}</th>}</>
  return <>{!simple && <dl className="model-totals" aria-label={t(`${label}预报降雪`, `Forecast snowfall ${label}`)}>{snowModels.map(m => <div key={m.id}><dt><i style={{ background: m.color }} />{m.name}</dt><dd><strong>{snow(total(sum, m.id), units.snow)}</strong> {units.snow}<span>{sumLabel}{sum === future && !future.modelStatus[m.id].endsWith('完整') && ` · ${statusLabel(future.modelStatus[m.id])}`}</span>{past && sum !== past && <span>{t(`过去 ${past.dates.length} 天累计`, `Past ${past.dates.length}-day total`)} {snow(total(past, m.id), units.snow)} {units.snow}</span>}</dd></div>)}</dl>}<div id={id} className="chart-heading"><h2>{archived ? t('存档的七日降雪预报', 'Archived 7-day snowfall forecast') : t(`${label}降雪`, `Snowfall ${label}`)} <small>({units.snow})</small></h2>{onDays && <span className="chart-span" aria-live="polite">{offsetLabel(days[0])} {t('至', 'to')} {offsetLabel(days[1])} · {t(`共 ${days[1] - days[0] + 1} 天`, `${days[1] - days[0] + 1} day${days[1] > days[0] ? 's' : ''}`)}</span>}<div className="legend">{!simple && series.map(m => <span key={m.id}><i style={{ background: m.color }} />{m.name}</span>)}{periods && <span className="legend-parts">{t('每天左柱白天（浅），右柱夜间', 'Left bar: day (light) · right bar: night')}</span>}</div></div>{onDays && <div className="chart-timeline"><TimelinePicker range={days} today={data.dates[0]} onChange={onDays} /></div>}<SnowChart data={shown} periods={periods} series={series} units={units} split={split} simple={simple} />{simple && <SimpleLegend />}<div className="table-scroll" tabIndex={0} role="region" aria-label={periods ? t('昼夜明细，可横向滚动', 'Day and night details, scrolls horizontally') : t('逐日明细，可横向滚动', 'Daily details, scrolls horizontally')}>{simple ? <table><thead><tr>{dateHead}<th>{t('加权降雪', 'Weighted snow')} ({units.snow})</th><th>{t('模型范围', 'Model range')} ({units.snow})</th><th>{t('模型一致性', 'Model agreement')}</th><th>{t('雪质', 'Snow quality')}</th><th>{t('雪线', 'Snow level')} ({units.elevation})</th><th>{t('阵风', 'Gusts')} ({units.wind})</th><th>{t('温度', 'Temp')} ({units.temperature})</th></tr></thead><tbody>{rows.map(row => { const { f, j } = row; return <tr key={row.key} className={row.className}>{dateCell(row)}{partCell(row)}<td><strong>{snow(value(f, 'snowfall_sum', weighted.id, j), units.snow)}</strong></td><td>{range(f, j)}</td><td>{!row.past && <AgreementTag a={snowAgreement(f, j)} />}</td><td><Grade data={f} i={j} wetLabel={wetLabel} /></td><td><SnowLevel data={f} i={j} point={data.query.elevation} units={units} /></td><td>{wind(value(f, 'wind_gusts_10m_max', weighted.id, j), units)}</td><td>{temp(value(f, 'temperature_2m_min', weighted.id, j), units)} / {temp(value(f, 'temperature_2m_max', weighted.id, j), units)}</td></tr> })}</tbody></table> : <table><thead><tr>{dateHead}{snowModels.map(m => <th key={m.id}>{m.name} ({units.snow})</th>)}<th>{t('降雪范围', 'Snow range')} ({units.snow})</th><th>{t('模型一致性', 'Model agreement')}</th><th>{t('加权雪质', 'Weighted quality')}</th><th>{t('雪线', 'Snow level')} ({units.elevation})</th>{gustModels.map(m => <th key={`${m.id}-wind`}>{m.name} {t('阵风', 'gusts')} ({units.wind})</th>)}{tempModels.map(m => <th key={`${m.id}-temp`}>{m.name} {t('温度', 'temp')} ({units.temperature})</th>)}</tr></thead><tbody>{rows.map(row => { const { f, j } = row; return <tr key={row.key} className={row.className}>{dateCell(row)}{partCell(row)}{snowModels.map(m => <td key={m.id}>{snow(value(f, 'snowfall_sum', m.id, j), units.snow)}</td>)}<td>{range(f, j)}</td><td>{!row.past && <AgreementTag a={snowAgreement(f, j)} />}</td><td><Grade data={f} i={j} wetLabel={wetLabel} /></td><td><SnowLevel data={f} i={j} point={data.query.elevation} units={units} /></td>{gustModels.map(m => <td key={`${m.id}-wind`}>{wind(value(f, 'wind_gusts_10m_max', m.id, j), units)}</td>)}{tempModels.map(m => <td key={`${m.id}-temp`}>{temp(value(f, 'temperature_2m_min', m.id, j), units)} / {temp(value(f, 'temperature_2m_max', m.id, j), units)}</td>)}</tr> })}</tbody></table>}</div><GradeRules /><p className="muted footnote">{t('— 表示缺失。', '— means missing. ')}{days[1] > 7 && t('ICON 预报约 7.5 天，更远日期无数据；第 2 周仅供初筛。', 'ICON covers about 7.5 days and has no data beyond that; treat week 2 as a rough guide. ')}{agreementNote}</p></>
}
