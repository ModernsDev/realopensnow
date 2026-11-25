import { elevationLabel, type QueryPoint, type Resort } from './catalog'
import { temp, wind, type Units } from './units'
import { compareForecasts } from './compareForecasts'
import { models, snow, total, weighted, weightLabel, type Forecast, type Weights } from './weather'

type Candidate = { resort: Resort; point: QueryPoint; data?: Forecast; error?: string; loading: boolean }

export function Comparison({ candidates, selected, onToggle, weights, model, setModel, units, refresh }: {
  candidates: Candidate[]
  selected: string[]
  onToggle: (id: string) => void
  weights: Weights
  model: string
  setModel: (model: string) => void
  units: Units
  refresh: () => void
}) {
  const comparing = candidates.filter(({ resort }) => selected.includes(resort.id))
  const enough = comparing.length >= 2
  const loading = comparing.some(candidate => candidate.loading)
  const { dates, columns } = compareForecasts(comparing.map(candidate => candidate.data), model)

  const options = models.filter(m => m.id === model || comparing.some(({ data }) => data && total(data, m.id) !== null))

  return <section className="detail compare">
    <fieldset className="compare-picker">
      <legend>选择收藏雪场（2–5 个）</legend>
      {candidates.map(({ resort }) => {
        const checked = selected.includes(resort.id)
        return <label key={resort.id}>
          <input type="checkbox" checked={checked} disabled={!checked && comparing.length === 5} onChange={() => onToggle(resort.id)} />
          {resort.name}
        </label>
      })}
      <span role="status">已选 {comparing.length}/5</span>
    </fieldset>
    {enough ? <>
      <div className="controls compare-controls">
        <label>预报模型 <select value={model} onChange={e => setModel(e.target.value)}>{[weighted, ...options].map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <button onClick={refresh} disabled={loading}>{comparing.some(candidate => candidate.error) ? '重试预报' : '刷新预报'}</button>
      </div>
      {loading ? <p role="status" className="empty">正在获取所选雪场的预报…</p> : <>
        {dates.length > 0
          ? <p className="compare-window"><strong>{dates[0]} 至 {dates.at(-1)}</strong> · {dates.length} 天</p>
          : <p role="status">暂无共同可用日期。</p>}
        <div className="table-scroll" tabIndex={0} role="region" aria-label="收藏雪场对比，可横向滚动">
          <table>
            <thead><tr><th scope="col">雪场</th>{columns.map(({ index }) => {
              const { resort, point } = comparing[index]
              return <th scope="col" key={resort.id}>
                {resort.name}
                <span>{point.name}</span>
                <span>查询海拔 {elevationLabel(point, units)}</span>
                
                <button className="compare-remove" aria-label={`移除 ${resort.name}`} onClick={() => onToggle(resort.id)}>移除</button>
              </th>
            })}</tr></thead>
            <tbody>
              <tr><th scope="row">累计降雪 ({units.snow})</th>{columns.map(({ index, total, rank }) => (
                <td key={comparing[index].resort.id}>{comparing[index].error
                  ? <span className="error">{comparing[index].error} · 未排名</span>
                  : rank === null ? dates.length ? '数据缺失 · 未排名' : '无共同日期 · 未排名' : `第 ${rank} 名 · ${snow(total, units.snow)}`}</td>
              ))}</tr>
              {dates.map((date, i) => <tr key={date}>
                <th scope="row">{date}</th>
                {columns.map(({ index, days }) => <td key={comparing[index].resort.id}>
                  <span>降雪 {days[i].snow === null ? '缺失' : `${snow(days[i].snow, units.snow)} ${units.snow}`}</span>
                  <span>气温 {days[i].low === null ? '缺失' : `${temp(days[i].low, units)} ${units.temperature}`} 至 {days[i].high === null ? '缺失' : `${temp(days[i].high, units)} ${units.temperature}`}</span>
                  <span>阵风 {days[i].gust === null ? '缺失' : `${wind(days[i].gust, units)} ${units.wind}`}</span>
                </td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
        {model === weighted.id && <p className="muted">加权综合 = {weightLabel(weights)} · <a href="#settings">修改权重</a></p>}
      </>}
    </> : <p className="empty">{candidates.length < 2 ? '请先收藏至少两个雪场。' : '请选择至少两个收藏雪场开始对比。'}</p>}
  </section>
}
