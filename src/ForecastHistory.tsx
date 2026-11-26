import { useEffect, useState } from 'react'
import { waterburyPoint, type QueryPoint } from './catalog'
import { models, snow, type Forecast } from './weather'
import { ForecastView } from './Forecast'
import type { Units } from './units'

type Snapshot = { id: number; data: Forecast }
type HistoryPage = { snapshots: Snapshot[]; next: number | null }
type Accuracy = {
  groups: { model: string; lead: number; count: number; bias: number | null; mae: number | null; insufficient: boolean }[]
}
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) {
    const error = response.headers.get('content-type')?.includes('application/json') ? (await response.json()).error : null
    throw new Error(error ?? `快照服务返回 HTTP ${response.status}。`)
  }
  return response.json()
}

export function ForecastHistory({ point, units }: { point: QueryPoint; units: Units }) {
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
      setSaved(`已保存快照 #${snapshot.id}`)
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
    <summary>{station ? '历史预报与准确性' : '历史预报'}</summary>
    {open && <>
      <div className="controls"><button onClick={save} disabled={saving}>{saving ? '保存中…' : '获取并保存快照'}</button></div>
      {saved && <p role="status">{saved}</p>}
      {historyError && <p role="alert">{historyError}</p>}
      {!page && !historyError && <p role="status">正在读取历史快照…</p>}
      {page && !page.snapshots.length && <p>暂无历史快照。</p>}
      {page?.snapshots.map(({ id, data }) => <details key={id}><summary>快照 #{id}</summary><ForecastView mode="multi" data={data} units={units} archived /></details>)}
      <div className="controls">
        {before !== null && <button onClick={() => go(null)}>最新快照</button>}
        {page?.next != null && <button onClick={() => go(page.next)}>更早的快照</button>}
      </div>
      {station && <>
        <h3>预报准确性</h3>
        {accuracyError ? <p role="alert">{accuracyError}</p> : accuracy ? <>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="各模型分提前量误差，可横向滚动">
            <table><thead><tr><th>模型</th><th>提前量</th><th>样本数</th><th>平均偏差（预报 − 实测，{units.snow}）</th><th>平均绝对误差 ({units.snow})</th><th>样本状态</th></tr></thead><tbody>
              {accuracy.groups.filter(group => group.count || models.slice(0, 3).some(m => m.id === group.model)).map(group => <tr key={`${group.model}-${group.lead}`}><td>{models.find(model => model.id === group.model)?.name}</td><td>{group.lead * 24}–&lt;{(group.lead + 1) * 24} 小时</td><td>{group.count}</td><td>{snow(group.bias, units.snow)}</td><td>{snow(group.mae, units.snow)}</td><td>{group.insufficient ? '样本不足' : '—'}</td></tr>)}
            </tbody></table>
          </div>
        </> : <p role="status">正在核对预报与观测…</p>}
      </>}
    </>}
  </details>
}
