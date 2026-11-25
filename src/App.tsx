import { useEffect, useState } from 'react'
import { forecast, forecastExpired, resorts, type ForecastWithReport } from './weather'
import { ForecastView, Report } from './Forecast'
import { ForecastHistory } from './ForecastHistory'
import { CatalogDetails } from './CatalogDetails'
import { Observations } from './ResortObservations'
import { Comparison } from './Comparison'
import { elevationLabel, queryBlockReason, searchResorts } from './catalog'
import { readFavorites, saveFavorites } from './favorites'
import { Regions } from './Regions'
import './App.css'

type ForecastResult = { request: { key: string } } & ({ data: ForecastWithReport; error?: never } | { error: string; data?: never })

const views = { resorts: '我的雪场', compare: '雪场对比', report: '每日雪报', regions: '北美区域雪势' } as const
type View = keyof typeof views
const currentView = (): View => window.location.hash === '#regions' ? 'regions' : window.location.hash === '#compare' ? 'compare' : window.location.hash === '#report' ? 'report' : 'resorts'

function App() {
  const [favoriteState, setFavoriteState] = useState(() => readFavorites(document, () => localStorage))
  const favorites = favoriteState.ids
  const [selected, setSelected] = useState(favoriteState.ids[0] ?? 'alta')
  const [pointIds, setPointIds] = useState<Record<string, string>>({})
  const pointFor = (r: typeof resorts[number]) => r.points.find(p => p.id === pointIds[r.id]) ?? r.points.find(p => !queryBlockReason(r, p)) ?? r.points[0]
  const [comparisonIds, setComparisonIds] = useState(() => favorites.slice(0, 5))
  const [comparisonModel, setComparisonModel] = useState('ecmwf_ifs025')
  const [unit, setUnit] = useState('cm')
  const [view, setView] = useState(currentView)
  const navigate = (next: View) => {
    window.location.hash = next
    setView(next)
  }
  useEffect(() => {
    const onHashChange = () => setView(currentView())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  const [now, setClock] = useState(Date.now)
  useEffect(() => {
    const update = () => setClock(Date.now())
    const timer = window.setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [revision, setRevision] = useState(0)
  const [results, setResults] = useState<Record<string, ForecastResult>>({})
  const resort = resorts.find(r => r.id === (!adding && favorites.length && !favorites.includes(selected) ? favorites[0] : selected))!
  const point = pointFor(resort)
  const key = `${resort.id}-${point.id}`
  const blocked = queryBlockReason(resort, point)
  const queryKeys = [...new Set([resort.id, ...favorites])].sort().map(id => { const r = resorts.find(r => r.id === id)!; return `${id}:${pointFor(r).id}` }).join('|')
  const requestKey = `${revision}:${queryKeys}`
  const [request, setRequest] = useState({ key: requestKey })
  if (request.key !== requestKey) setRequest({ key: requestKey })
  const pending = (k: string) => results[k]?.request !== request
  const active = (k: string) => {
    const { data, error } = results[k] ?? {}
    if (data && forecastExpired(data, now)) return { error: '预报已过期，请重新获取。' }
    return { data: pending(k) ? undefined : data, error }
  }
  const { data, error } = active(key)
  useEffect(() => {
    const controller = new AbortController()
    const queries = queryKeys.split('|').map(entry => {
      const [id, pointId] = entry.split(':')
      const r = resorts.find(r => r.id === id)!
      const p = r.points.find(p => p.id === pointId)!
      return { r, p, k: `${id}-${pointId}` }
    }).filter(({ r, p }) => !queryBlockReason(r, p))
    for (const { r, p, k } of queries) {
      forecast(r, p, controller.signal).then(data => {
        if (!controller.signal.aborted) setResults(prev => ({ ...prev, [k]: { request, data } }))
      }).catch(e => {
        if (!controller.signal.aborted) setResults(prev => ({ ...prev, [k]: { request, error: e.message } }))
      })
    }
    return () => controller.abort()
  }, [queryKeys, request])
  const refresh = () => setRevision(r => r + 1)
  const toggle = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id]
    setFavoriteState({ ids: next, error: saveFavorites(next, document) })
    if (!next.includes(id)) setComparisonIds(ids => ids.filter(value => value !== id))
    if (id === selected && !next.includes(id) && next.length) setSelected(next[0])
  }
  const tracked = favorites.map(id => resorts.find(r => r.id === id)!)
  const reportsLoading = tracked.some(r => !queryBlockReason(r, pointFor(r)) && pending(`${r.id}-${pointFor(r).id}`))
  const listed = searchResorts(search).filter(r => adding || favorites.includes(r.id))
  return <><header className="topbar"><div className="topbar-inner"><a className="brand" href="/"><img src="/favicon.svg" alt="" />RealOpenSnow</a><nav aria-label="主导航">{(Object.keys(views) as View[]).map(name => <button aria-current={view === name ? 'page' : undefined} className={view === name ? 'active' : ''} onClick={() => navigate(name)} key={name}>{views[name]}</button>)}</nav><div className="actions"><input aria-label="搜索雪场" placeholder="搜索雪场" value={search} onChange={e => { setSearch(e.target.value); setAdding(true); navigate('resorts') }} /><button className="primary" onClick={() => { setAdding(!adding); setSearch(''); navigate('resorts') }}>{adding ? '返回收藏' : '添加雪场'}</button></div></div></header><div className="page-head"><div className="page-head-inner"><h1>{views[view]}</h1><p>多模型预报，追踪每一场雪</p></div></div><main>
    {favoriteState.error && <div role="alert" className="empty error">{favoriteState.error}<button onClick={() => setFavoriteState({ ids: favorites, error: saveFavorites(favorites, document) })}>重试保存收藏</button></div>}
    {view === 'regions' ? <Regions /> : view === 'resorts' ? <div className="workspace"><section className="resort-list" aria-label="雪场列表">{listed.length ? listed.map(r => <div key={r.id} className={`resort ${resort.id === r.id ? 'selected' : ''}`}><button className="resort-select" aria-pressed={resort.id === r.id} onClick={() => setSelected(r.id)}><strong>{r.name}</strong><span>{r.region}</span><span>{r.points.filter(p => !queryBlockReason(r, p)).length} 个可用查询点 · {r.areas.length} 个目录分区</span></button><button className={`star ${favorites.includes(r.id) ? 'saved' : ''}`} aria-label={`${favorites.includes(r.id) ? '取消收藏' : '收藏'} ${r.name}`} onClick={() => toggle(r.id)}>{favorites.includes(r.id) ? '★' : '☆'}</button></div>) : <p className="empty">{search.trim() ? '没有匹配雪场，请调整名称或地区。' : '还没有收藏雪场，点击“添加雪场”开始追踪。'}</p>}<p className="muted footnote">首批 6 个雪场目录项；待核实点暂不生成预报。</p></section>{!adding && !favorites.length ? <section className="detail"><p role="status" className="empty">收藏后可在这里查看雪场详情。</p></section> : <section className="detail"><div className="detail-header"><h2>{resort.name}</h2><div className="controls"><label>海拔 <select aria-label="海拔" value={point.id} onChange={e => setPointIds(prev => ({ ...prev, [resort.id]: e.target.value }))}>{resort.points.map(p => <option key={p.id} value={p.id}>{p.name} · {elevationLabel(p)}</option>)}</select></label><select aria-label="降雪单位" value={unit} onChange={e => setUnit(e.target.value)}><option>cm</option><option>in</option></select><button onClick={refresh} disabled={pending(key) || !!blocked}>{pending(key) ? '获取中…' : '刷新'}</button></div></div>{blocked ? <p role="status" className="empty">{blocked}</p> : error ? <div role="alert" className="empty error">{error}<button onClick={refresh} disabled={pending(key)}>{pending(key) ? '正在重试…' : '重试'}</button>{pending(key) && <p role="status">正在重试，成功后更新预报。</p>}</div> : data ? <ForecastView data={data} unit={unit} id={`forecast-${resort.id}-${point.id}`} /> : <p role="status" className="empty">正在获取真实天气预报…</p>}<Observations key={resort.id} resort={resort} unit={unit} now={now} />{!blocked && <ForecastHistory key={point.id} point={point} unit={unit} />}<CatalogDetails resort={resort} point={point} /></section>}</div> : view === 'compare' ? <Comparison
      candidates={tracked.map(r => {
        const point = pointFor(r)
        const k = `${r.id}-${point.id}`
        const blocked = queryBlockReason(r, point)
        const result = active(k)
        return { resort: r, point, data: result.data, error: blocked || result.error, loading: !blocked && pending(k) }
      })}
      selected={comparisonIds}
      onToggle={id => setComparisonIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : ids.length < 5 ? [...ids, id] : ids)}
      model={comparisonModel}
      setModel={setComparisonModel}
      unit={unit}
      setUnit={setUnit}
      refresh={refresh}
    /> : <div>
      {tracked.length ? <div className="controls">
        <label>降雪单位 <select aria-label="降雪单位" value={unit} onChange={e => setUnit(e.target.value)}><option>cm</option><option>in</option></select></label>
        <button onClick={refresh} disabled={reportsLoading}>{reportsLoading ? '获取中…' : '刷新雪报'}</button>
      </div> : <p role="status" className="empty">还没有收藏雪场，添加收藏后查看每日雪报。</p>}
      {tracked.map(r => {
        const p = pointFor(r)
        const k = `${r.id}-${p.id}`
        const unavailable = queryBlockReason(r, p)
        const { data: f, error } = active(k)
        return <section className="report-card" key={r.id} aria-label={r.name}>
          <h2>{r.name}</h2>
          {unavailable ? <p className="empty" role="status">{unavailable}</p>
            : error ? <div className="empty error" role="alert"><p>每日雪报暂不可用。{error}</p><button onClick={refresh} disabled={reportsLoading}>{pending(k) ? '正在重试…' : '重试'}</button></div>
            : f ? <Report data={f} unit={unit} />
            : <p className="empty" role="status">正在获取预报，雪报将在数据完整后生成。</p>}
        </section>
      })}
    </div>}
    {view === 'resorts' && favorites.includes(resort.id) && data && !blocked && !error && <Report data={data} unit={unit} inWorkspace />}<footer><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0（本站按当地日汇总）</a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a><span>预测降雪 ≠ 实测积雪 · 追踪清单保存在此浏览器的 cookie</span></footer></main></>
}
export default App
