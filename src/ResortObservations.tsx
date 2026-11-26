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
      if (!controller.signal.aborted) setResult({ error: error.name === 'TimeoutError' ? '请求超时' : error.message })
    })
    return () => controller.abort()
  }, [station])

  const readings = result && 'readings' in result ? result.readings : undefined
  const loading = station && !result
  const rows = [
    { name: station?.provider === 'snotel' ? '附近测站 24 小时积雪增量' : '附近测站 24 小时新雪', reading: readings?.newSnow },
    { name: '附近测站积雪深度', reading: readings?.depth },
  ]
  return <section className="catalog observation-section" aria-label="雪况">
    <h3>雪况</h3>
    {result && 'error' in result && <p role="alert" className="error">测站数据暂不可用 · {result.error}</p>}
    <dl className="observation-readings">
      {children}
      {!resort.custom && rows.map(({ name, reading }) => <div key={name}>
        <dt>{name}</dt>
        <dd>{loading ? '获取中…' : reading ? <strong>{expiredObservation(reading, now, station?.maxAgeHours) ? '已过期' : reading.trace ? '微量' : `${snow(reading.cm, units.snow)} ${units.snow}`}</strong> : '未知'}</dd>
      </div>)}
    </dl>
  </section>
}
