import { useEffect, useState } from 'react'
import { waterburyPoint, type QueryPoint, type Resort } from './catalog'
import { models, snow, type Forecast } from './weather'
import { ForecastView } from './Forecast'

type Snapshot = { id: number; data: Forecast }
type HistoryPage = { snapshots: Snapshot[]; next: number | null }
type Accuracy = {
  groups: { model: string; lead: number; count: number; bias: number | null; mae: number | null; insufficient: boolean }[]
  excluded: { station: number; window: number; measurement: number; forecast: number }
  minimumSamples: number
}
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    const error = response.headers.get('content-type')?.includes('application/json') ? (await response.json()).error : null
    throw new Error(error ?? `快照服务返回 HTTP ${response.status}。`)
  }
  return response.json()
}

export function ForecastHistory({ resort, point, unit }: { resort: Resort; point: QueryPoint; unit: string }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<HistoryPage>()
  const [accuracy, setAccuracy] = useState<Accuracy>()
  const [historyError, setHistoryError] = useState('')
  const [accuracyError, setAccuracyError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [before, setBefore] = useState<number | null>(null)
  const [revision, reload] = useState(0)
  const station = point.id === waterburyPoint.id
  const path = `/api/forecast-snapshots/${point.id}`

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    request<HistoryPage>(path + (before === null ? '' : `?before=${before}`), { signal: controller.signal }).then(result => {
      setHistoryError('')
      setPage(result)
    }).catch(error => { if (!controller.signal.aborted) setHistoryError(error.message) })
    return () => controller.abort()
  }, [open, revision, before, path])

  useEffect(() => {
    if (!open || !station) return
    const controller = new AbortController()
    request<Accuracy>(`/api/forecast-accuracy/${point.id}`, { signal: controller.signal }).then(result => {
      setAccuracyError('')
      setAccuracy(result)
    }).catch(error => { if (!controller.signal.aborted) setAccuracyError(error.message) })
    return () => controller.abort()
  }, [open, station, revision, point.id])

  if (import.meta.env.VITE_HOSTED_FORECAST !== '1') return null

  async function save() {
    setSaving(true)
    setSaved('')
    try {
      const snapshot = await request<Snapshot>(path, { method: 'POST' })
      setSaved(`已保存快照 #${snapshot.id} · ${snapshot.data.fetched}`)
      setBefore(null)
      reload(value => value + 1)
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '快照保存失败。')
    } finally {
      setSaving(false)
    }
  }

  const go = (cursor: number | null) => {
    setPage(undefined)
    setBefore(cursor)
  }

  return <details className="catalog" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>历史预报与准确性</summary>
    {open && <>
      <p>保存会请求一次新的三模型预报。历史只包含本站已保存的快照。</p>
      <div className="controls"><button onClick={save} disabled={saving}>{saving ? '保存中…' : '获取并保存快照'}</button></div>
      {saved && <p role="status">{saved}</p>}
      {historyError && <p role="alert">{historyError} <button onClick={() => reload(value => value + 1)}>重读历史</button></p>}
      {!page && !historyError && <p role="status">正在读取历史快照…</p>}
      {page && !page.snapshots.length && <p>暂无历史快照。</p>}
      {page?.snapshots.map(({ id, data }) => <details key={id}><summary>快照 #{id} · <time dateTime={data.fetched}>{data.fetched}</time></summary><ForecastView resort={resort} mode="multi" data={data} unit={unit} archived /></details>)}
      <div className="controls">
        {before !== null && <button onClick={() => go(null)}>最新快照</button>}
        {page?.next != null && <button onClick={() => go(page.next)}>更早的快照</button>}
      </div>
      <h3>直接新雪验证</h3>
      {!station ? <p>{point.id.startsWith('stowe-') ? 'Waterbury 观测位于不同坐标和海拔。请选择 Waterbury 同址参考点查看验证。' : point.id.startsWith('niseko-') ? '倶知安气象厅发布的是积雪增量汇总，且与此查询点不同址。' : point.id.startsWith('alta-') || point.id.startsWith('snowbird-') ? '现有 NRCS 实测是地面积雪深度。此点暂无可比的直接新雪观测。' : '此点暂无同址直接新雪观测。'}</p> : <>
        <p>最近 30 天 Waterbury 直接新雪，由 <a href="https://dex.cocorahs.org/stations/VT-WS-19/obs-tables">CoCoRaHS VT-WS-19</a> 提供。误差以完整实测窗口开始前的获取时间分档，每 6 小时取最后一次存档，每模型和提前量对同一窗口最多计一次。</p>
        {accuracyError ? <p role="alert">{accuracyError} <button onClick={() => reload(value => value + 1)}>重试</button></p> : accuracy ? <>
          <p>每档少于 {accuracy.minimumSamples} 个窗口标为样本不足。偏差为预报减实测，绝对误差为两者差值绝对值的平均。</p>
          <p>排除的观测窗 · 测站不符 {accuracy.excluded.station} · 时间窗无法确认 {accuracy.excluded.window} · 缺测、微量或单位不符 {accuracy.excluded.measurement} · 无可用的提前预报 {accuracy.excluded.forecast}</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="各模型分提前量误差，可横向滚动">
            <table><thead><tr><th>模型</th><th>提前量</th><th>样本数</th><th>平均偏差 ({unit})</th><th>平均绝对误差 ({unit})</th><th>样本状态</th></tr></thead><tbody>
              {accuracy.groups.map(group => <tr key={`${group.model}-${group.lead}`}><td>{models.find(model => model.id === group.model)?.name}</td><td>{group.lead * 24}–&lt;{(group.lead + 1) * 24} 小时</td><td>{group.count}</td><td>{snow(group.bias, unit)}</td><td>{snow(group.mae, unit)}</td><td>{group.insufficient ? '样本不足' : '—'}</td></tr>)}
            </tbody></table>
          </div>
        </> : <p role="status">正在核对预报与观测…</p>}
      </>}
    </>}
  </details>
}
