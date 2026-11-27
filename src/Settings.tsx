import { lang, setLang, t } from './i18n'
import { useState } from 'react'
import { defaultWeights, models, weightShares, type Weights } from './weather'
import { validHidden, validWeights } from './weights'
import { imperial, metric, unitOptions, type Units } from './units'

export function Settings({ units, onUnits, weights, hidden, error, onSave }: { units: Units; onUnits: (units: Units) => void; weights: Weights; hidden: string[]; error: string | null; onSave: (weights: Weights, hidden: string[]) => void }) {
  const [draft, setDraft] = useState(weights)
  const [shown, setShown] = useState(hidden)
  const [saved, setSaved] = useState(false)
  const [langError, setLangError] = useState<string | null>(null)
  const valid = validWeights(draft) && validHidden(shown)
  const shares = valid ? weightShares(draft) : null
  const change = (next: Weights) => { setDraft(next); setSaved(false) }
  return <><section className="detail settings" aria-label={t('语言', 'Language')}>
    <h2>{t('语言', 'Language')}</h2>
    <div className="mode-switch" role="group" aria-label={t('语言', 'Language')}>{([['zh', '中文'], ['en', 'English']] as const).map(([value, label]) => <button key={value} lang={value} aria-pressed={lang === value} onClick={() => setLangError(setLang(value))}>{label}</button>)}</div>
    {langError && <p role="alert" className="error">{langError}</p>}
  </section>
  <section className="detail settings" aria-label={t('单位', 'Units')}>
    <h2>{t('单位', 'Units')}</h2>
    <div className="controls">{([[t('全部公制', 'All metric'), metric], [t('全部英制', 'All imperial'), imperial]] as const).map(([label, preset]) => <button key={label} aria-pressed={JSON.stringify(units) === JSON.stringify(preset)} onClick={() => onUnits(preset)}>{label}</button>)}</div>
    {(Object.keys(unitOptions) as (keyof Units)[]).map(k => <div className="unit-row" key={k}><span>{unitOptions[k].label}</span><div className="mode-switch" role="group" aria-label={`${unitOptions[k].label} ${t('单位', 'units')}`}>{unitOptions[k].options.map(o => <button key={o} aria-pressed={units[k] === o} onClick={() => onUnits({ ...units, [k]: o })}>{o}</button>)}</div></div>)}
    <p className="muted">{t('单位保存在此浏览器中，应用于全部页面。', 'Units are saved in this browser and apply to every page.')}</p>
  </section>
  <section className="detail settings" aria-label={t('模型权重', 'Model weights')}>
    <h2>{t('模型权重与显示', 'Model weights and visibility')}</h2>
    <p>{t('权重决定加权综合，按比例换算为实际占比，合计无需等于 100；设为 0 即不参与加权。某地没有数据的模型自动跳过，其余按比例放大。', 'Weights set the weighted blend. They are converted to proportional shares, so they need not add up to 100; 0 excludes a model. Models without data at a location are skipped and the rest scaled up.')}</p>
    <p>{t('「显示」决定多模型比较、模型范围和对比选项里出现哪些模型，不影响加权综合。', '“Show” controls which models appear in the model comparison, model range and compare options. It does not affect the weighted blend.')}</p>
    <form onSubmit={e => { e.preventDefault(); onSave(draft, shown); setSaved(true) }}>
      {models.map(m => <div className="weight-row" key={m.id}>
        <label htmlFor={`weight-${m.id}`}><i style={{ background: m.color }} />{m.name}</label>
        <label className="show-toggle"><input type="checkbox" checked={!shown.includes(m.id)} onChange={e => { setShown(e.target.checked ? shown.filter(id => id !== m.id) : [...shown, m.id]); setSaved(false) }} />{t('显示', 'Show')}</label>
        <input type="range" id={`weight-${m.id}`} min="0" max="100" step="1" value={draft[m.id] || 0} onChange={e => change({ ...draft, [m.id]: e.target.valueAsNumber })} />
        <input type="number" aria-label={`${m.name} ${t('权重', 'weight')}`} required min="0" max="100" step="1" value={Number.isNaN(draft[m.id]) ? '' : draft[m.id]} onChange={e => change({ ...draft, [m.id]: e.target.valueAsNumber })} />
        <output htmlFor={`weight-${m.id}`}>{shares ? `${shares[m.id]}%` : '—'}</output>
      </div>)}
      {!valid && <p role="alert" className="error">{t('请输入 0–100 的整数，至少一个模型权重大于 0，且至少显示一个模型。', 'Enter whole numbers from 0 to 100, give at least one model a weight above 0, and show at least one model.')}</p>}
      <div className="controls">
        <button className="primary" disabled={!valid}>{t('保存设置', 'Save settings')}</button>
        <button type="button" onClick={() => { setDraft(defaultWeights); setShown([]); onSave(defaultWeights, []); setSaved(true) }}>{t('恢复默认值', 'Restore defaults')}</button>
        {error ? <span role="alert" className="error">{error}</span> : saved && <span role="status">{t('已保存', 'Saved')}</span>}
      </div>
    </form>
    <p className="muted">{t('未登录时，设置只保存在此浏览器中；登录后会同步到你的账户。', 'Signed out, settings stay in this browser; after you sign in they sync to your account.')}</p>
  </section></>
}
