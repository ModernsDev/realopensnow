import { t } from './i18n'
import { useEffect, useState, type ReactNode } from 'react'
import type { Resort } from './catalog'
import { expiredObservation, getObservations, observationStations } from './observations'
import { snow } from './weather'
import type { Units } from './units'

type Result = { readings: Awaited<ReturnType<typeof getObservations>> } | { error: string }

export function Observations({ resort, units, now, children }: { resort: Resort; units: Units; now: number; children?: ReactNode }) {
  const station = observationStations[resort.id]
  const [result, setResult] = useState<Result>()
  useEffect(() => {
    if (!station) return
    const controller = new AbortController()
    getObservations(station, controller.signal).then(readings => {
      if (!controller.signal.aborted) setResult({ readings })
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setResult({ error: error.name === 'TimeoutError' ? t('请求超时', 'Request timed out') : error.message })
    })
    return () => controller.abort()
  }, [station])

  const readings = result && 'readings' in result ? result.readings : undefined
  const loading = station && !result
  const rows = [
    { name: station?.provider === 'snotel' ? t('附近测站 24 小时积雪增量', 'Nearby station 24 h depth gain') : t('附近测站 24 小时新雪', 'Nearby station 24 h new snow'), reading: readings?.newSnow },
    { name: t('附近测站积雪深度', 'Nearby station snow depth'), reading: readings?.depth },
  ]
  return <section className="catalog observation-section" aria-label={t('雪况', 'Conditions')}>
    <h3>{t('雪况', 'Conditions')}</h3>
    {result && 'error' in result && <p role="alert" className="error">{t('测站数据暂不可用', 'Station data unavailable')} · {result.error}</p>}
    <dl className="observation-readings">
      {children}
      {!resort.custom && rows.map(({ name, reading }) => <div key={name}>
        <dt>{name}</dt>
        <dd>{loading ? t('获取中…', 'Loading…') : reading ? <strong>{expiredObservation(reading, now, station?.maxAgeHours) ? t('已过期', 'Stale') : reading.trace ? t('微量', 'Trace') : `${snow(reading.cm, units.snow)} ${units.snow}`}</strong> : t('未知', 'Unknown')}</dd>
      </div>)}
    </dl>
  </section>
}
