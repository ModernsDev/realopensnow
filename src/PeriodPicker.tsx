import type { CSSProperties } from 'react'
import { forecastPeriods, offsetLabel, timeline, type Period } from './weather'

export function PeriodPicker({ period, onSelect, periods = forecastPeriods }: { period: number; onSelect: (period: number) => void; periods?: readonly Period[] }) {
  return <div className="forecast-periods" role="group" aria-label="预报时段">
    {periods.map(([label], index) => <button key={label} aria-pressed={period === index} onClick={() => onSelect(index)}>{label}</button>)}
  </div>
}

export function TimelinePicker({ range: [from, to], today, onChange }: { range: [number, number]; today: string; onChange: (range: [number, number]) => void }) {
  const span = timeline.max - timeline.min
  const position = (n: number) => (n - timeline.min) / span
  const date = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(5, 10)
  const ticks = Array.from({ length: span + 1 }, (_, i) => timeline.min + i)
  return <div className="timeline" role="group" aria-label="日期范围">
    <div className="timeline-track" style={{ '--from': position(from), '--to': position(to), '--today': position(0) } as CSSProperties}>
      <div className="timeline-fill" />
      <div className="timeline-today" />
      <input type="range" aria-label="开始日期" aria-valuetext={`${date(from)} ${offsetLabel(from)}`} min={timeline.min} max={timeline.max} value={from} onChange={e => onChange([Math.min(Number(e.target.value), to), to])} />
      <input type="range" aria-label="结束日期" aria-valuetext={`${date(to)} ${offsetLabel(to)}`} min={timeline.min} max={timeline.max} value={to} onChange={e => onChange([from, Math.max(Number(e.target.value), from)])} />
    </div>
    <div className="timeline-ticks" aria-hidden="true">{ticks.map(n => <span key={n} className={n === 0 ? 'today' : n % 7 === 0 ? 'week' : undefined} style={{ left: `calc(${position(n)} * (100% - 20px) + 10px)` }}>{n === 0 ? '今天' : n % 7 === 0 ? date(n) : ''}</span>)}</div>
  </div>
}
