import { t } from './i18n'
import { useId, useState, type KeyboardEvent } from 'react'
import { searchResorts, type Resort } from './catalog'

export function ResortSearch({ resorts, favorites, onSelect }: { resorts: Resort[]; favorites: string[]; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const id = useId()
  const suggestions = query.trim() ? searchResorts(query, resorts).slice(0, 8) : []
  const shown = open && query.trim() !== ''
  const index = Math.min(active, suggestions.length - 1)
  const choose = (r: Resort) => {
    onSelect(r.id)
    setQuery('')
    setOpen(false)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      if (suggestions.length) setActive((index + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
    } else if (e.key === 'Enter' && suggestions.length) {
      e.preventDefault()
      choose(suggestions[index])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }
  return <div className="search">
    <input role="combobox" aria-label={t('搜索雪场', 'Search resorts')} placeholder={t('搜索雪场，回车打开', 'Search resorts, Enter to open')} value={query} autoComplete="off"
      aria-expanded={shown} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={shown && suggestions.length ? `${id}-${index}` : undefined}
      onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
    {shown && <ul id={`${id}-list`} role="listbox" aria-label={t('匹配的雪场', 'Matching resorts')} className="suggestions">
      {suggestions.length ? suggestions.map((r, i) => <li key={r.id} id={`${id}-${i}`} role="option" aria-selected={i === index}
        onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
        <span><strong>{r.name}</strong><small>{r.region}</small></span>{favorites.includes(r.id) && <span className="saved" aria-label={t('已收藏', 'Favorite')}>★</span>}
      </li>) : <li className="none" role="option" aria-selected={false} aria-disabled>{t('没有匹配的雪场', 'No matching resorts')}</li>}
    </ul>}
  </div>
}
