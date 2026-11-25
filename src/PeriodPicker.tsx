import { forecastPeriods, pastPeriods, type Period } from './weather'

export function PeriodPicker({ period, onSelect, periods = forecastPeriods }: { period: number; onSelect: (period: number) => void; periods?: readonly Period[] }) {
  return <div className="forecast-periods" role="group" aria-label="预报时段">
    {periods.map(([label], index) => <button key={label} aria-pressed={period === index} onClick={() => onSelect(index)}>{label}</button>)}
  </div>
}

export function HorizonPicker({ past, future, onPast, onFuture }: { past: number | null; future: number | null; onPast: (past: number | null) => void; onFuture: (future: number | null) => void }) {
  return <div className="horizon-picker">
    <div className="horizon-group" role="group" aria-label="过去">
      <small>过去</small>
      <div className="forecast-periods">{pastPeriods.map(([label], index) => <button key={label} aria-pressed={past === index} onClick={() => onPast(past === index && future !== null ? null : index)}>{label}</button>)}</div>
    </div>
    <div className="horizon-divider" aria-hidden="true" />
    <div className="horizon-group" role="group" aria-label="未来">
      <small>未来</small>
      <div className="forecast-periods">{forecastPeriods.map(([label], index) => <button key={label} aria-pressed={future === index} onClick={() => onFuture(future === index && past !== null ? null : index)}>{label}</button>)}</div>
    </div>
  </div>
}
