import { useEffect, useState } from 'react'
import { sources, type Resort } from './catalog'
import { expiredObservation, getObservations, observationStations } from './observations'
import { snow } from './weather'
import type { Units } from './units'

const operatorReports: Record<string, string> = {
  alta: 'https://www.alta.com/lift-terrain-status',
  snowbird: 'https://www.snowbird.com/the-mountain/mountain-report/lift-trail-report/',
  niseko: 'https://www.niseko.ne.jp/en/niseko-lift-status/',
  chamonix: 'https://domaineschamonix.montblancnaturalresort.com/fr/domaine/grands-montets',
  killington: 'https://killington.com/mountain-report',
  stowe: 'https://www.stowe.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx',
}

type Result = { readings: Awaited<ReturnType<typeof getObservations>> } | { error: string }

export function Observations({ resort, units, now }: { resort: Resort; units: Units; now: number }) {
  const station = observationStations[resort.id]
  const operatorReport = operatorReports[resort.id] ?? resort.website ?? (resort.identitySources[0] === 'openskimap' ? undefined : sources[resort.identitySources[0]].url)
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
    { name: '附近测站 24 小时新雪', reading: readings?.newSnow },
    { name: '附近测站积雪深度', reading: readings?.depth },
  ]
  return <section className="catalog observation-section" aria-label="雪况">
    <h3>雪况</h3>
    {result && 'error' in result && <p role="alert" className="error">测站数据暂不可用 · {result.error}</p>}
    <dl className="observation-readings">
      {rows.map(({ name, reading }) => <div key={name}>
        <dt>{name}</dt>
        <dd>{loading ? '获取中…' : reading ? <strong>{expiredObservation(reading, now, station?.maxAgeHours) ? '已过期' : reading.trace ? '微量' : `${snow(reading.cm, units.snow)} ${units.snow}`}</strong> : '未知'}</dd>
      </div>)}
      <div><dt>雪道与缆车开放</dt><dd>未知{operatorReport && <> · <a href={operatorReport} target="_blank" rel="noreferrer">运营方实况</a></>}</dd></div>
    </dl>
  </section>
}
