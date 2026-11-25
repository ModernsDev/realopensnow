import { forecastPeriods } from './weather'

export function PeriodPicker({ period, onSelect }: { period: number; onSelect: (period: number) => void }) {
  return <div className="forecast-periods" role="group" aria-label="预报时段">
    {forecastPeriods.map(([label], index) => <button key={label} aria-pressed={period === index} onClick={() => onSelect(index)}>{label}</button>)}
  </div>
}
