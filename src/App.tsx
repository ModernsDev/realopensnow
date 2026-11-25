import { useEffect, useMemo, useState } from 'react'
import { forecast, forecastExpired, resorts, type ForecastWithReport } from './weather'
import { ForecastView, Report } from './Forecast'
import { ForecastHistory } from './ForecastHistory'
import { CatalogDetails } from './CatalogDetails'
import { Observations } from './ResortObservations'
import { Comparison } from './Comparison'
import { elevationLabel, queryBlockReason, searchResorts } from './catalog'
import { readFavorites, saveFavorites } from './favorites'
import { customResort, readCustomLocations, saveCustomLocations, type CustomLocation } from './customLocations'
import { CustomLocationForm } from './CustomLocationForm'
import { Regions } from './Regions'
import './App.css'

type ForecastResult = { request: { key: string } } & ({ data: ForecastWithReport; error?: never } | { error: string; data?: never })

const views = { resorts: '我的雪场', compare: '雪场对比', report: '每日雪报', regions: '北美区域雪势' } as const
type View = keyof typeof views
const currentView = (): View => window.location.hash === '#regions' ? 'regions' : window.location.hash === '#compare' ? 'compare' : window.location.hash === '#report' ? 'report' : 'resorts'

const storage = () => localStorage
const pageSize = 60
const regions = [...new Set(resorts.map(r => r.region))]
const elevationRange = (r: typeof resorts[number]) => {
  const values = r.points.filter(p => p.kind !== 'reference' && p.elevation.value !== null).map(p => p.elevation.value!)
  const [low, high] = [Math.min(...values), Math.max(...values)]
  return low === high ? `${low.toLocaleString('zh-CN')} m` : `${low.toLocaleString('zh-CN')}–${high.toLocaleString('zh-CN')} m`
}
const idsOf = (locations: CustomLocation[]) => new Set([...resorts, ...locations].map(r => r.id))
const regionGroups = [['US', '美国'], ['CA', '加拿大'], ['MX', '墨西哥']].map(([code, label]) => ({
  label,
  options: [...new Set(resorts.filter(r => r.country === code).map(r => r.region))].sort((a, b) => a.localeCompare(b, 'en')),
}))
const otherRegions = regions.filter(region => !regionGroups.some(g => g.options.includes(region)))

function App() {
  const [customState, setCustomState] = useState(() => readCustomLocations(storage))
  const custom = customState.locations
  const customResorts = useMemo(() => custom.map(customResort), [custom])
  const allResorts = useMemo(() => [...customResorts, ...resorts], [customResorts])
  const byId = useMemo(() => new Map(allResorts.map(r => [r.id, r])), [allResorts])
  const [region, setRegion] = useState('')
  const [limit, setLimit] = useState(pageSize)
  const [creating, setCreating] = useState(false)
  const [favoriteState, setFavoriteState] = useState(() => readFavorites(storage, idsOf(custom)))
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
  const resort = byId.get(!adding && favorites.length && !favorites.includes(selected) ? favorites[0] : selected) ?? resorts[0]
  const point = pointFor(resort)
  const key = `${resort.id}-${point.id}`
  const blocked = queryBlockReason(resort, point)
  const queryKeys = [...new Set([resort.id, ...favorites])].sort().map(id => { const r = byId.get(id)!; return `${id}:${pointFor(r).id}` }).join('|')
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
      const r = byId.get(id)!
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
  }, [queryKeys, request, byId])
  const refresh = () => setRevision(r => r + 1)
  const toggle = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id]
    setFavoriteState({ ids: next, error: saveFavorites(next, storage, idsOf(custom)) })
    if (!next.includes(id)) setComparisonIds(ids => ids.filter(value => value !== id))
    if (id === selected && !next.includes(id) && next.length) setSelected(next[0])
  }
  const addLocation = (location: CustomLocation) => {
    const locations = [...custom, location]
    const next = [...favorites, location.id]
    setCustomState({ locations, error: saveCustomLocations(locations, storage) })
    setFavoriteState({ ids: next, error: saveFavorites(next, storage, idsOf(locations)) })
    setSelected(location.id)
    setCreating(false)
    setAdding(false)
    setSearch('')
  }
  const removeLocation = (id: string) => {
    const locations = custom.filter(l => l.id !== id)
    const next = favorites.filter(x => x !== id)
    setCustomState({ locations, error: saveCustomLocations(locations, storage) })
    setFavoriteState({ ids: next, error: saveFavorites(next, storage, idsOf(locations)) })
    setComparisonIds(ids => ids.filter(value => value !== id))
    setSelected(next[0] ?? 'alta')
  }
  const tracked = favorites.map(id => byId.get(id)!)
  const reportsLoading = tracked.some(r => !queryBlockReason(r, pointFor(r)) && pending(`${r.id}-${pointFor(r).id}`))
  const listed = adding ? searchResorts(search, allResorts).filter(r => !region || r.region === region) : tracked
  return <><header className="topbar"><div className="topbar-inner"><a className="brand" href="/"><img src="/favicon.svg" alt="" />RealOpenSnow</a><nav aria-label="主导航">{(Object.keys(views) as View[]).map(name => <button aria-current={view === name ? 'page' : undefined} className={view === name ? 'active' : ''} onClick={() => navigate(name)} key={name}>{views[name]}</button>)}</nav><div className="actions"><input aria-label="搜索雪场" placeholder="搜索雪场" value={search} onChange={e => { setSearch(e.target.value); setLimit(pageSize); setAdding(true); setCreating(false); navigate('resorts') }} /><button className="primary" onClick={() => { setAdding(!adding); setCreating(false); setSearch(''); setLimit(pageSize); navigate('resorts') }}>{adding ? '返回收藏' : '添加雪场'}</button><button onClick={() => { setCreating(true); navigate('resorts') }}>自定义坐标</button></div></div></header><div className="page-head"><div className="page-head-inner"><h1>{views[view]}</h1><p>多模型预报，追踪每一场雪</p></div></div><main>
    {favoriteState.error && <div role="alert" className="empty error">{favoriteState.error}<button onClick={() => setFavoriteState({ ids: favorites, error: saveFavorites(favorites, storage, idsOf(custom)) })}>重试保存收藏</button></div>}
    {customState.error && <div role="alert" className="empty error">{customState.error}<button onClick={() => setCustomState({ locations: custom, error: saveCustomLocations(custom, storage) })}>保存当前地点列表</button></div>}
    {view === 'regions' ? <Regions /> : view === 'resorts' ? <div className="workspace"><section className="resort-list" aria-label="雪场列表">{adding && <div className="list-filter"><select aria-label="按地区筛选" value={region} onChange={e => { setRegion(e.target.value); setLimit(pageSize) }}><option value="">全部地区</option>{custom.length > 0 && <option>自定义地点</option>}{regionGroups.filter(g => g.options.length).map(g => <optgroup key={g.label} label={g.label}>{g.options.map(name => <option key={name} value={name}>{name.split(' · ')[0]}</option>)}</optgroup>)}<optgroup label="其他">{otherRegions.map(name => <option key={name}>{name}</option>)}</optgroup></select><span role="status">{listed.length} 个雪场</span></div>}{listed.length ? listed.slice(0, adding ? limit : undefined).map(r => <div key={r.id} className={`resort ${resort.id === r.id ? 'selected' : ''}`}><button className="resort-select" aria-pressed={resort.id === r.id} onClick={() => { setSelected(r.id); setCreating(false) }}><strong>{r.name}</strong><span>{r.region}</span><span>{elevationRange(r)}</span></button><button className={`star ${favorites.includes(r.id) ? 'saved' : ''}`} aria-label={`${favorites.includes(r.id) ? '取消收藏' : '收藏'} ${r.name}`} onClick={() => toggle(r.id)}>{favorites.includes(r.id) ? '★' : '☆'}</button></div>) : <p className="empty">{search.trim() ? '没有匹配雪场，请调整名称或地区。' : '还没有收藏雪场，点击“添加雪场”开始追踪。'}</p>}{adding && listed.length > limit && <button className="more" onClick={() => setLimit(limit + pageSize)}>显示更多（还有 {listed.length - limit} 个）</button>}<p className="muted footnote">目录共 {resorts.length} 个雪场，覆盖北美。没有找到的地点可用“自定义坐标”添加。</p></section>{creating ? <CustomLocationForm onAdd={addLocation} onCancel={() => setCreating(false)} /> : !adding && !favorites.length ? <section className="detail"><p role="status" className="empty">收藏后可在这里查看雪场详情。</p></section> : <section className="detail"><div className="detail-header"><h2>{resort.name}</h2><div className="controls"><label>海拔 <select aria-label="海拔" value={point.id} onChange={e => setPointIds(prev => ({ ...prev, [resort.id]: e.target.value }))}>{resort.points.map(p => <option key={p.id} value={p.id}>{p.name} · {elevationLabel(p)}</option>)}</select></label><select aria-label="降雪单位" value={unit} onChange={e => setUnit(e.target.value)}><option>cm</option><option>in</option></select>{resort.custom && <button onClick={() => { if (window.confirm(`删除自定义地点“${resort.name}”？`)) removeLocation(resort.id) }}>删除地点</button>}<button onClick={refresh} disabled={pending(key) || !!blocked}>{pending(key) ? '获取中…' : '刷新'}</button></div></div>{blocked ? <p role="status" className="empty">{blocked}</p> : error ? <div role="alert" className="empty error">{error}<button onClick={refresh} disabled={pending(key)}>{pending(key) ? '正在重试…' : '重试'}</button>{pending(key) && <p role="status">正在重试，成功后更新预报。</p>}</div> : data ? <ForecastView resort={resort} data={data} unit={unit} id={`forecast-${resort.id}-${point.id}`} /> : <p role="status" className="empty">正在获取真实天气预报…</p>}{!resort.custom && <Observations key={resort.id} resort={resort} unit={unit} now={now} />}{!blocked && !resort.custom && <ForecastHistory key={point.id} resort={resort} point={point} unit={unit} />}<CatalogDetails resort={resort} point={point} /></section>}</div> : view === 'compare' ? <Comparison
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
            : f ? <Report resort={r} data={f} unit={unit} />
            : <p className="empty" role="status">正在获取预报，雪报将在数据完整后生成。</p>}
        </section>
      })}
    </div>}
    {view === 'resorts' && !creating && favorites.includes(resort.id) && data && !blocked && !error && <Report resort={resort} data={data} unit={unit} inWorkspace />}<footer><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0（本站按当地日汇总）</a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a><span>预测降雪 ≠ 实测积雪 · 收藏保存在本机</span></footer></main></>
}
export default App
