import { useState } from 'react'
import { defaultWeights, coreModels, weightShares, type Weights } from './weather'
import { validWeights } from './weights'
import { imperial, metric, unitOptions, type Units } from './units'

export function Settings({ units, onUnits, weights, error, onSave }: { units: Units; onUnits: (units: Units) => void; weights: Weights; error: string | null; onSave: (weights: Weights) => void }) {
  const [draft, setDraft] = useState(weights)
  const [saved, setSaved] = useState(false)
  const valid = validWeights(draft)
  const shares = valid ? weightShares(draft) : null
  const change = (next: Weights) => { setDraft(next); setSaved(false) }
  return <><section className="detail settings" aria-label="单位">
    <h2>单位</h2>
    <div className="controls">{([['公制', metric], ['英制', imperial]] as const).map(([label, preset]) => <button key={label} aria-pressed={JSON.stringify(units) === JSON.stringify(preset)} onClick={() => onUnits(preset)}>全部{label}</button>)}</div>
    {(Object.keys(unitOptions) as (keyof Units)[]).map(k => <div className="unit-row" key={k}><span>{unitOptions[k].label}</span><div className="mode-switch" role="group" aria-label={`${unitOptions[k].label}单位`}>{unitOptions[k].options.map(o => <button key={o} aria-pressed={units[k] === o} onClick={() => onUnits({ ...units, [k]: o })}>{o}</button>)}</div></div>)}
    <p className="muted">单位保存在此浏览器中，应用于全部页面。</p>
  </section>
  <section className="detail settings" aria-label="模型权重">
    <h2>模型权重</h2>
    <p>调整简化模式和雪场对比中的加权综合。权重按比例换算为实际占比，合计无需等于 100；设为 0 即不使用该模型。</p>
    <form onSubmit={e => { e.preventDefault(); onSave(draft); setSaved(true) }}>
      {coreModels.map(m => <div className="weight-row" key={m.id}>
        <label htmlFor={`weight-${m.id}`}><i style={{ background: m.color }} />{m.name}</label>
        <input type="range" id={`weight-${m.id}`} min="0" max="100" step="1" value={draft[m.id] || 0} onChange={e => change({ ...draft, [m.id]: e.target.valueAsNumber })} />
        <input type="number" aria-label={`${m.name} 权重`} required min="0" max="100" step="1" value={Number.isNaN(draft[m.id]) ? '' : draft[m.id]} onChange={e => change({ ...draft, [m.id]: e.target.valueAsNumber })} />
        <output htmlFor={`weight-${m.id}`}>{shares ? `占 ${shares[m.id]}%` : '—'}</output>
      </div>)}
      {!valid && <p role="alert" className="error">请输入 0–100 的整数，且至少一个模型大于 0。</p>}
      <div className="controls">
        <button className="primary" disabled={!valid}>保存权重</button>
        <button type="button" onClick={() => { setDraft(defaultWeights); onSave(defaultWeights); setSaved(true) }}>恢复默认值</button>
        {error ? <span role="alert" className="error">{error}</span> : saved && <span role="status">已保存</span>}
      </div>
    </form>
    <p className="muted">权重保存在此浏览器的 cookie 中，有效期一年；换浏览器或清除 cookie 后恢复默认。</p>
  </section></>
}
