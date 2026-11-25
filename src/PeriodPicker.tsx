import { forecastPeriods, type Period } from './weather'

export function PeriodPicker({ period, onSelect, periods = forecastPeriods }: { period: number; onSelect: (period: number) => void; periods?: readonly Period[] }) {
  return <div className="forecast-periods" role="group" aria-label="预报时段">
    {periods.map(([label], index) => <button key={label} aria-pressed={period === index} onClick={() => onSelect(index)}>{label}</button>)}
  </div>
}
