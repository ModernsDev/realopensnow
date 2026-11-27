import { lang, t } from './i18n'
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
  const response = await fetch(path, { ...options, headers: { 'accept-language': lang } })
  if (!response.ok) {
    const error = response.headers.get('content-type')?.includes('application/json') ? (await response.json()).error : null
    throw new Error(error ?? t(`快照服务返回 HTTP ${response.status}。`, `Snapshot service returned HTTP ${response.status}.`))
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
      setSaved(t(`已保存快照 #${snapshot.id}`, `Saved snapshot #${snapshot.id}`))
      setBefore(null)
      reload(value => value + 1)
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : t('快照保存失败。', 'Could not save the snapshot.'))
    } finally {
      setSaving(false)
    }
  }

  const go = (cursor: number | null) => {
    setPage(undefined)
    setBefore(cursor)
  }

  return <details className="catalog" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{station ? t('历史预报与准确性', 'Forecast history and accuracy') : t('历史预报', 'Forecast history')}</summary>
    {open && <>
      <div className="controls"><button onClick={save} disabled={saving}>{saving ? t('保存中…', 'Saving…') : t('获取并保存快照', 'Fetch and save snapshot')}</button></div>
      {saved && <p role="status">{saved}</p>}
      {historyError && <p role="alert">{historyError}</p>}
      {!page && !historyError && <p role="status">{t('正在读取历史快照…', 'Loading snapshots…')}</p>}
      {page && !page.snapshots.length && <p>{t('暂无历史快照。', 'No snapshots yet.')}</p>}
      {page?.snapshots.map(({ id, data }) => <details key={id}><summary>{t('快照', 'Snapshot')} #{id}</summary><ForecastView mode="multi" data={data} units={units} archived /></details>)}
      <div className="controls">
        {before !== null && <button onClick={() => go(null)}>{t('最新快照', 'Latest snapshots')}</button>}
        {page?.next != null && <button onClick={() => go(page.next)}>{t('更早的快照', 'Older snapshots')}</button>}
      </div>
      {station && <>
        <h3>{t('预报准确性', 'Forecast accuracy')}</h3>
        {accuracyError ? <p role="alert">{accuracyError}</p> : accuracy ? <>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t('各模型分提前量误差，可横向滚动', 'Error by model and lead time, scrolls horizontally')}>
            <table><thead><tr><th>{t('模型', 'Model')}</th><th>{t('提前量', 'Lead time')}</th><th>{t('样本数', 'Samples')}</th><th>{t(`平均偏差（预报 − 实测，${units.snow}）`, `Mean bias (forecast − observed, ${units.snow})`)}</th><th>{t('平均绝对误差', 'Mean absolute error')} ({units.snow})</th><th>{t('样本状态', 'Sample status')}</th></tr></thead><tbody>
              {accuracy.groups.filter(group => group.count || models.slice(0, 3).some(m => m.id === group.model)).map(group => <tr key={`${group.model}-${group.lead}`}><td>{models.find(model => model.id === group.model)?.name}</td><td>{group.lead * 24}–&lt;{(group.lead + 1) * 24} {t('小时', 'h')}</td><td>{group.count}</td><td>{snow(group.bias, units.snow)}</td><td>{snow(group.mae, units.snow)}</td><td>{group.insufficient ? t('样本不足', 'Too few samples') : '—'}</td></tr>)}
            </tbody></table>
          </div>
        </> : <p role="status">{t('正在核对预报与观测…', 'Checking forecasts against observations…')}</p>}
      </>}
    </>}
  </details>
}
