import { useEffect, useState } from 'react'
import type { Resort } from './catalog'
import { sources } from './catalog'
import { expiredObservation, getObservations, observationStations } from './observations'
import { snow } from './weather'

const operatorReports: Record<string, string> = {
  alta: 'https://www.alta.com/lift-terrain-status',
  snowbird: 'https://www.snowbird.com/the-mountain/mountain-report/lift-trail-report/',
  niseko: 'https://www.niseko.ne.jp/en/niseko-lift-status/',
  chamonix: 'https://domaineschamonix.montblancnaturalresort.com/fr/domaine/grands-montets',
  killington: 'https://killington.com/mountain-report',
  stowe: 'https://www.stowe.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx',
}

type Result = { readings: Awaited<ReturnType<typeof getObservations>> } | { error: string }

export function Observations({ resort, unit, now }: { resort: Resort; unit: string; now: number }) {
  const station = observationStations[resort.id]
  const operatorReport = operatorReports[resort.id] ?? resort.website ?? (resort.identitySources[0] === 'openskimap' ? undefined : sources[resort.identitySources[0]].url)
  const [result, setResult] = useState<Result>()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!station) return
    const controller = new AbortController()
    getObservations(station, controller.signal).then(readings => {
      if (!controller.signal.aborted) setResult({ readings })
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setResult({ error: error.name === 'TimeoutError' ? '请求超时' : error.message })
    })
    return () => controller.abort()
  }, [station, revision])

  const readings = result && 'readings' in result ? result.readings : undefined
  const rows = [
    { name: station?.provider === 'amedas' ? '新雪（按测站积雪增量汇总）' : '实测新雪', reading: readings?.newSnow, window: '截至观测时刻的过去 24 小时' },
    { name: '实测积雪深度', reading: readings?.depth, window: '观测时刻（无累计）' },
  ]
  return <>
    <section className="catalog observation-section" aria-label="测站雪况">
      <h3>测站雪况</h3>
      {station ? <>
        <p>地点 {station.name} · 海拔 {station.elevation === null ? '未知' : `${station.elevation.toLocaleString('zh-CN')} m`} · 附近测站</p>
        <p>来源 <a href={station.url} target="_blank" rel="noreferrer">{station.source}</a> · <a href={station.terms} target="_blank" rel="noreferrer">数据使用条款</a> · 本站转换显示单位</p>
        {station.provider === 'amedas' && <p><a href="https://www.data.jma.go.jp/stats/mdrr/snc_rct/legend.html" target="_blank" rel="noreferrer">日本气象厅降雪量口径</a> · 逐小时积雪增量的合计</p>}
      </> : <p>该雪场暂无已接入的观测站。</p>}
      {station && !result && <p role="status">正在获取测站数据…</p>}
      {result && 'error' in result && <p role="alert" className="error">观测源暂不可用 · {result.error}</p>}
      {readings && !readings.newSnow && !readings.depth && <p role="status">数据源暂无有效观测。</p>}
      {(readings || !station) && <dl className="observation-readings">
        {rows.map(row => {
          const entry = row.reading
          const expired = entry && expiredObservation(entry, now, station?.maxAgeHours)
          return <div key={row.name}>
            <dt>{row.name}</dt>
            <dd>{entry ? <>
              <strong>{expired ? '观测已过期' : entry.trace ? '微量' : `${snow(entry.cm, unit)} ${unit}`}</strong>
              <span>{expired ? '最后观测 ' : '观测 '}{new Date(entry.observedAt).toLocaleString('zh-CN', { timeZone: resort.timezone, timeZoneName: 'short' })}</span>
              <span>窗口 {row.window}</span>
            </> : '未知'}</dd>
          </div>
        })}
      </dl>}
      {station && result && <button type="button" onClick={() => { setResult(undefined); setRevision(next => next + 1) }}>刷新测站数据</button>}
    </section>
    <section className="catalog observation-section" aria-label="雪场运营">
      <h3>雪场运营</h3>
      <dl className="observation-readings">
        <div><dt>雪道开放</dt><dd>未知</dd></div>
        <div><dt>缆车开放</dt><dd>未知</dd></div>
      </dl>
      {operatorReport ? <p><a href={operatorReport} target="_blank" rel="noreferrer">查看运营方信息</a></p> : <p>暂无运营方网站。</p>}
    </section>
  </>
}
