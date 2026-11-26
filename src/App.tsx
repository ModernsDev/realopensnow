import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { dailyReport, defaultRange, defaultWeights, forecast, forecastExpired, resorts, snow, total, weighted, type ForecastWithReport, type Mode } from './weather'
import { ForecastView, ModeSwitch, ReportTile, SnowTotals } from './Forecast'
import { ForecastHistory } from './ForecastHistory'
import { Observations } from './ResortObservations'
import { Comparison } from './Comparison'
import { elevationLabel, queryBlockReason } from './catalog'
import { ResortSearch } from './ResortSearch'
import { readFavorites, saveFavorites } from './favorites'
import { customResort, readCustomLocations, saveCustomLocations, validLocation, type CustomLocation } from './customLocations'
import { accountsEnabled, loadAccount, saveUserData, signIn, signOut, type Account, type UserData } from './account'
import { CustomLocationForm } from './CustomLocationForm'
import { Settings } from './Settings'
import { elevation, metric, readUnits, saveUnits, validUnits, type Units } from './units'
import { readHidden, readWeights, saveSettings, validHidden, validWeights } from './weights'
import { Regions } from './Regions'
import './App.css'

const SnowMountain = lazy(() => import('./SnowMountain'))

type ForecastResult = { request: { key: string } } & ({ data: ForecastWithReport; error?: never } | { error: string; data?: never })

const views = { resorts: '我的雪场', compare: '雪场对比', report: '每日雪报', regions: '北美区域雪势', settings: '设置' } as const
type View = keyof typeof views
const currentView = (): View => window.location.hash === '#settings' ? 'settings' : window.location.hash === '#regions' ? 'regions' : window.location.hash === '#compare' ? 'compare' : window.location.hash === '#report' ? 'report' : 'resorts'

const storage = () => localStorage
const elevationRange = (r: typeof resorts[number], units: Units) => {
  const values = r.points.filter(p => p.kind !== 'reference' && p.elevation.value !== null).map(p => p.elevation.value!)
  const [low, high] = [Math.min(...values), Math.max(...values)]
  return low === high ? `${elevation(low, units)} ${units.elevation}` : `${elevation(low, units)}–${elevation(high, units)} ${units.elevation}`
}
const idsOf = (locations: CustomLocation[]) => new Set([...resorts, ...locations].map(r => r.id))

function App() {
  const [customState, setCustomState] = useState(() => readCustomLocations(storage))
  const custom = customState.locations
  const customResorts = useMemo(() => custom.map(customResort), [custom])
  const allResorts = useMemo(() => [...customResorts, ...resorts], [customResorts])
  const byId = useMemo(() => new Map(allResorts.map(r => [r.id, r])), [allResorts])
  const [creating, setCreating] = useState(false)
  const [favoriteState, setFavoriteState] = useState(() => readFavorites(document, storage, idsOf(custom)))
  const favorites = favoriteState.ids
  const [selected, setSelected] = useState(favoriteState.ids[0] ?? '')
  const [pointIds, setPointIds] = useState<Record<string, string>>({})
  const pointFor = (r: typeof resorts[number]) => r.points.find(p => p.id === pointIds[r.id]) ?? r.points.find(p => !queryBlockReason(r, p)) ?? r.points[0]
  const [comparisonIds, setComparisonIds] = useState(() => favorites.slice(0, 5))
  const [comparisonModel, setComparisonModel] = useState(weighted.id)
  const [mode, setMode] = useState<Mode>('simple')
  const [weightState, setWeightState] = useState(() => {
    const { weights, error } = readWeights(document, storage)
    const hidden = readHidden(document, storage)
    return { weights, hidden: hidden.hidden, error: error ?? hidden.error }
  })
  const [units, setUnitsState] = useState(() => readUnits(storage))
  const setUnits = (next: Units) => { saveUnits(next, storage); setUnitsState(next) }
  const [range, setRange] = useState(defaultRange)
  const [view, setView] = useState(currentView)
  const [account, setAccount] = useState<Account | null | undefined>(accountsEnabled ? undefined : null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const saving = useRef(Promise.resolve())
  const applyUserData = (data: UserData) => {
    const locations = data.customLocations.filter(validLocation)
    const ids = idsOf(locations)
    const next = data.favorites.filter(id => ids.has(id))
    const merged = { ...defaultWeights, ...data.weights }
    const weights = validWeights(merged) ? merged : defaultWeights
    const hidden = validHidden(data.hidden) ? data.hidden : []
    setCustomState({ locations, error: saveCustomLocations(locations, storage) })
    setFavoriteState({ ids: next, error: saveFavorites(next, storage, ids) })
    setWeightState({ weights, hidden, error: saveSettings(weights, hidden, storage) })
    setUnits(validUnits(data.units) ? data.units : metric)
    setComparisonIds(next.slice(0, 5))
    setSelected(prev => ids.has(prev) ? prev : next[0] ?? '')
  }
  useEffect(() => {
    if (!accountsEnabled) return
    loadAccount().then(result => {
      if (result?.data) applyUserData(result.data)
      setAccount(result?.user ?? null)
    }).catch(e => { setAccount(null); setAccountError(e.message) })
  }, [])
  useEffect(() => {
    if (!account) return
    const data = { favorites, customLocations: custom, weights: weightState.weights, hidden: weightState.hidden, units }
    saving.current = saving.current.then(() => saveUserData(data)).then(setAccountError)
  }, [account, favorites, custom, weightState.weights, weightState.hidden, units])
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
  const [revision, setRevision] = useState(0)
  const [results, setResults] = useState<Record<string, ForecastResult>>({})
  const resort = byId.get(selected) ?? resorts[0]
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
    if (pending(k) || !data || forecastExpired(data, now)) return { error }
    const prefs = { weights: weightState.weights, hidden: weightState.hidden }
    const view = { ...data, ...prefs, past: { ...data.past, ...prefs }, extended: { ...data.extended, ...prefs } }
    return { data: { ...view, report: dailyReport(view, byId.get(data.query.resortId)!) }, error }
  }
  const { data, error } = active(key)
  const expired = queryKeys.split('|').some(entry => { const data = results[entry.replace(':', '-')]?.data; return !!data && forecastExpired(data, now) })
  const [wasExpired, setWasExpired] = useState(expired)
  if (expired !== wasExpired) { setWasExpired(expired); if (expired) setRevision(r => r + 1) }
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
  const toggle = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id]
    setFavoriteState({ ids: next, error: saveFavorites(next, storage, idsOf(custom)) })
    if (!next.includes(id)) setComparisonIds(ids => ids.filter(value => value !== id))
  }
  const addLocation = (location: CustomLocation) => {
    const locations = [...custom, location]
    const next = [...favorites, location.id]
    setCustomState({ locations, error: saveCustomLocations(locations, storage) })
    setFavoriteState({ ids: next, error: saveFavorites(next, storage, idsOf(locations)) })
    setSelected(location.id)
    setCreating(false)
  }
  const removeLocation = (id: string) => {
    const locations = custom.filter(l => l.id !== id)
    const next = favorites.filter(x => x !== id)
    setCustomState({ locations, error: saveCustomLocations(locations, storage) })
    setFavoriteState({ ids: next, error: saveFavorites(next, storage, idsOf(locations)) })
    setComparisonIds(ids => ids.filter(value => value !== id))
    setSelected(next[0] ?? '')
  }
  const tracked = favorites.map(id => byId.get(id)!)
  return <><header className="topbar"><div className="topbar-inner"><a className="brand" href="/"><img src="/favicon.svg" alt="" />RealOpenSnow</a><nav aria-label="主导航">{(Object.keys(views) as View[]).map(name => <button aria-current={view === name ? 'page' : undefined} className={view === name ? 'active' : ''} onClick={() => navigate(name)} key={name}>{views[name]}</button>)}</nav><div className="actions"><ResortSearch resorts={allResorts} favorites={favorites} onSelect={id => { setSelected(id); setCreating(false); navigate('resorts') }} /><button onClick={() => { setCreating(true); navigate('resorts') }}>自定义坐标</button>{accountsEnabled && account !== undefined && (account ? <button className="account" title={account.email} onClick={() => signOut().then(() => setAccount(null), e => setAccountError(e.message))}>{account.name} · 退出</button> : <button className="account" onClick={() => signIn().catch(e => setAccountError(e.message))}>Google 登录</button>)}</div></div></header><div className="page-head"><Suspense><SnowMountain /></Suspense><div className="page-head-inner"><h1>{views[view]}</h1></div></div><main>
    {accountError && <div role="alert" className="empty error">{accountError}<button onClick={() => setAccountError(null)}>关闭</button></div>}
    {favoriteState.error && <div role="alert" className="empty error">{favoriteState.error}<button onClick={() => setFavoriteState({ ids: favorites, error: saveFavorites(favorites, storage, idsOf(custom)) })}>重试保存收藏</button></div>}
    {customState.error && <div role="alert" className="empty error">{customState.error}<button onClick={() => setCustomState({ locations: custom, error: saveCustomLocations(custom, storage) })}>保存当前地点列表</button></div>}
    {weightState.error && view !== 'settings' && <div role="alert" className="empty error">{weightState.error}<button onClick={() => navigate('settings')}>打开设置</button></div>}
    {view === 'settings' ? <Settings units={units} onUnits={setUnits} weights={weightState.weights} hidden={weightState.hidden} error={weightState.error} onSave={(weights, hidden) => setWeightState({ weights, hidden, error: saveSettings(weights, hidden, storage) })} /> : view === 'regions' ? <Regions units={units} /> : view === 'resorts' ? <div className="workspace"><section className="resort-list" aria-label="雪场列表">{tracked.length ? tracked.map(r => { const f = active(`${r.id}-${pointFor(r).id}`).data; return <div key={r.id} className={`resort ${resort.id === r.id ? 'selected' : ''}`}><button className="resort-select" aria-pressed={resort.id === r.id} onClick={() => { setSelected(r.id); setCreating(false) }}><strong>{r.name}</strong><span>{r.region}</span><span>{elevationRange(r, units)}</span>{f && <span className="resort-snow">过去 7 天 <b>{snow(total(f.past, weighted.id), units.snow)}</b> · 未来 7 天 <b>{snow(total(f, weighted.id), units.snow)}</b> {units.snow}</span>}</button><button className={`star ${favorites.includes(r.id) ? 'saved' : ''}`} aria-label={`${favorites.includes(r.id) ? '取消收藏' : '收藏'} ${r.name}`} onClick={() => toggle(r.id)}>{favorites.includes(r.id) ? '★' : '☆'}</button></div> }) : <p className="empty">还没有收藏雪场。用右上角搜索打开雪场，再点标题旁的“添加”。</p>}</section>{creating ? <CustomLocationForm onAdd={addLocation} onCancel={() => setCreating(false)} /> : !byId.has(selected) ? <section className="detail"><p role="status" className="empty">收藏后可在这里查看雪场详情。</p></section> : <section className="detail"><div className="detail-header"><div className="detail-title"><h2>{resort.name}</h2><button className={`title-star ${favorites.includes(resort.id) ? 'saved' : ''}`} aria-pressed={favorites.includes(resort.id)} aria-label={`${favorites.includes(resort.id) ? '取消收藏' : '收藏'} ${resort.name}`} title={favorites.includes(resort.id) ? '从我的雪场移除' : '添加到我的雪场'} onClick={() => toggle(resort.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" /></svg><span>{favorites.includes(resort.id) ? '已添加' : '添加'}</span></button></div><div className="controls"><ModeSwitch mode={mode} setMode={setMode} /><label>海拔 <select aria-label="海拔" value={point.id} onChange={e => setPointIds(prev => ({ ...prev, [resort.id]: e.target.value }))}>{resort.points.map(p => <option key={p.id} value={p.id}>{p.name} · {elevationLabel(p, units)}</option>)}</select></label>{resort.custom && <button onClick={() => { if (window.confirm(`删除自定义地点“${resort.name}”？`)) removeLocation(resort.id) }}>删除地点</button>}</div></div>{(!resort.custom || (data && mode === 'simple')) && <Observations key={resort.id} resort={resort} units={units} now={now}>{data && mode === 'simple' && <SnowTotals data={data} days={range} units={units} />}</Observations>}{blocked ? <p role="status" className="empty">{blocked}</p> : error ? <div role="alert" className="empty error">{error}</div> : data ? <ForecastView data={data} days={range} onDays={setRange} units={units} mode={mode} id={`forecast-${resort.id}-${point.id}`} /> : <p role="status" className="empty">正在获取预报…</p>}{!blocked && !resort.custom && <ForecastHistory key={point.id} point={point} units={units} />}</section>}</div> : view === 'compare' ? <Comparison
      candidates={tracked.map(r => {
        const point = pointFor(r)
        const k = `${r.id}-${point.id}`
        const blocked = queryBlockReason(r, point)
        const result = active(k)
        return { resort: r, point, data: result.data, error: blocked || result.error, loading: !blocked && pending(k) }
      })}
      selected={comparisonIds}
      onToggle={id => setComparisonIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : ids.length < 5 ? [...ids, id] : ids)}
      weights={weightState.weights}
      hidden={weightState.hidden}
      model={comparisonModel}
      setModel={setComparisonModel}
      units={units}
    /> : <div>
      {tracked.length ? <div className="controls">
        <ModeSwitch mode={mode} setMode={setMode} />
      </div> : <p role="status" className="empty">还没有收藏雪场，添加收藏后查看每日雪报。</p>}
      {tracked.length > 0 && <div className="report-grid">{tracked.map(r => {
        const p = pointFor(r)
        const k = `${r.id}-${p.id}`
        const unavailable = queryBlockReason(r, p)
        const { data: f, error } = active(k)
        return <article className="report-tile" key={r.id} aria-label={`${r.name} 每日雪报`}>
          <h2><button onClick={() => { setSelected(r.id); setCreating(false); navigate('resorts') }}>{r.name}</button></h2>
          {unavailable ? <p className="tile-status" role="status">{unavailable}</p>
            : error ? <div className="tile-status error" role="alert"><p>暂不可用。{error}</p></div>
            : f ? <ReportTile resort={r} data={f} units={units} mode={mode} />
            : <p className="tile-status" role="status">正在获取预报…</p>}
        </article>
      })}</div>}
    </div>}</main></>
}
export default App
