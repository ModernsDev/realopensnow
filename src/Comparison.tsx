import { t } from './i18n'
import { elevationLabel, type QueryPoint, type Resort } from './catalog'
import { temp, wind, type Units } from './units'
import { compareForecasts } from './compareForecasts'
import { models, snow, total, weighted, weightLabel, type Forecast, type Weights } from './weather'

type Candidate = { resort: Resort; point: QueryPoint; data?: Forecast; error?: string; loading: boolean }

export function Comparison({ candidates, selected, onToggle, weights, model, setModel, units, hidden }: {
  hidden: string[]
  candidates: Candidate[]
  selected: string[]
  onToggle: (id: string) => void
  weights: Weights
  model: string
  setModel: (model: string) => void
  units: Units
}) {
  const comparing = candidates.filter(({ resort }) => selected.includes(resort.id))
  const enough = comparing.length >= 2
  const loading = comparing.some(candidate => candidate.loading)
  const { dates, columns } = compareForecasts(comparing.map(candidate => candidate.data), model)

  const options = models.filter(m => m.id === model || !hidden.includes(m.id) && comparing.some(({ data }) => data && total(data, m.id) !== null))

  return <section className="detail compare">
    <fieldset className="compare-picker">
      <legend>{t('选择收藏雪场（2–5 个）', 'Choose favorite resorts (2–5)')}</legend>
      {candidates.map(({ resort }) => {
        const checked = selected.includes(resort.id)
        return <label key={resort.id}>
          <input type="checkbox" checked={checked} disabled={!checked && comparing.length === 5} onChange={() => onToggle(resort.id)} />
          {resort.name}
        </label>
      })}
      <span role="status">{t('已选', 'Selected')} {comparing.length}/5</span>
    </fieldset>
    {enough ? <>
      <div className="controls compare-controls">
        <label>{t('预报模型', 'Forecast model')} <select value={model} onChange={e => setModel(e.target.value)}>{[weighted, ...options].map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      </div>
      {loading ? <p role="status" className="empty">{t('正在获取所选雪场的预报…', 'Loading forecasts for the selected resorts…')}</p> : <>
        {dates.length > 0
          ? <p className="compare-window"><strong>{dates[0]} {t('至', 'to')} {dates.at(-1)}</strong> · {t(`${dates.length} 天`, `${dates.length} day${dates.length > 1 ? 's' : ''}`)}</p>
          : <p role="status">{t('暂无共同可用日期。', 'No dates are available for all resorts.')}</p>}
        <div className="table-scroll" tabIndex={0} role="region" aria-label={t('收藏雪场对比，可横向滚动', 'Resort comparison, scrolls horizontally')}>
          <table>
            <thead><tr><th scope="col">{t('雪场', 'Resort')}</th>{columns.map(({ index }) => {
              const { resort, point } = comparing[index]
              return <th scope="col" key={resort.id}>
                {resort.name}
                <span>{point.name}</span>
                <span>{t('查询海拔', 'Elevation')} {elevationLabel(point, units)}</span>
                
                <button className="compare-remove" aria-label={`${t('移除', 'Remove')} ${resort.name}`} onClick={() => onToggle(resort.id)}>{t('移除', 'Remove')}</button>
              </th>
            })}</tr></thead>
            <tbody>
              <tr><th scope="row">{t('累计降雪', 'Total snow')} ({units.snow})</th>{columns.map(({ index, total, rank }) => (
                <td key={comparing[index].resort.id}>{comparing[index].error
                  ? <span className="error">{comparing[index].error} · {t('未排名', 'unranked')}</span>
                  : rank === null ? dates.length ? t('数据缺失 · 未排名', 'Missing data · unranked') : t('无共同日期 · 未排名', 'No shared dates · unranked') : t(`第 ${rank} 名 · ${snow(total, units.snow)}`, `#${rank} · ${snow(total, units.snow)}`)}</td>
              ))}</tr>
              {dates.map((date, i) => <tr key={date}>
                <th scope="row">{date}</th>
                {columns.map(({ index, days }) => <td key={comparing[index].resort.id}>
                  <span>{t('降雪', 'Snow')} {days[i].snow === null ? t('缺失', 'missing') : `${snow(days[i].snow, units.snow)} ${units.snow}`}</span>
                  <span>{t('气温', 'Temp')} {days[i].low === null ? t('缺失', 'missing') : `${temp(days[i].low, units)} ${units.temperature}`} {t('至', 'to')} {days[i].high === null ? t('缺失', 'missing') : `${temp(days[i].high, units)} ${units.temperature}`}</span>
                  <span>{t('阵风', 'Gusts')} {days[i].gust === null ? t('缺失', 'missing') : `${wind(days[i].gust, units)} ${units.wind}`}</span>
                </td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
        {model === weighted.id && <p className="muted">{t('加权综合', 'Weighted blend')} = {weightLabel(weights)} · <a href="#settings">{t('修改权重', 'Edit weights')}</a></p>}
      </>}
    </> : <p className="empty">{candidates.length < 2 ? t('请先收藏至少两个雪场。', 'Favorite at least two resorts first.') : t('请选择至少两个收藏雪场开始对比。', 'Choose at least two favorite resorts to compare.')}</p>}
  </section>
}
