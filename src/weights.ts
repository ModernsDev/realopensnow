import { t } from './i18n.ts'
import { defaultWeights, models, type Weights } from './weather.ts'
import { takeLegacyCookie, type CookieJar } from './legacyCookie.ts'

const weightsKey = 'snow-weights'
const hiddenKey = 'snow-hidden'
const ids = new Set(models.map(m => m.id))

export function validWeights(input: unknown): input is Weights {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length !== models.length || Object.keys(input).some(id => !ids.has(id))) return false
  const values = Object.values(input)
  return values.every(n => Number.isInteger(n) && n >= 0 && n <= 100) && values.some(n => n !== 0)
}
export const validHidden = (input: unknown): input is string[] =>
  Array.isArray(input) && input.length < models.length && new Set(input).size === input.length && input.every(id => ids.has(id))

type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>
const decode = (value: string) => { try { return decodeURIComponent(value) } catch { return value } }
function parse(jar: CookieJar, storage: StorageAccess, key: string) {
  try {
    takeLegacyCookie(jar, key, value => storage().setItem(key, decode(value)))
    const raw = storage().getItem(key)
    if (raw === null) return { found: false } as const
    return { found: true, value: JSON.parse(raw) as unknown } as const
  } catch { return { found: true, value: undefined } as const }
}

export function readWeights(jar: CookieJar, storage: StorageAccess): { weights: Weights; error: string | null } {
  const saved = parse(jar, storage, weightsKey)
  if (!saved.found) return { weights: defaultWeights, error: null }
  const merged = typeof saved.value === 'object' && saved.value !== null && !Array.isArray(saved.value) ? { ...defaultWeights, ...saved.value } : null
  if (validWeights(merged)) return { weights: merged, error: null }
  return { weights: defaultWeights, error: t('已保存的权重无效，当前使用默认权重；请重新保存。', 'Saved weights are invalid; default weights are in use. Please save again.') }
}
export function readHidden(jar: CookieJar, storage: StorageAccess): { hidden: string[]; error: string | null } {
  const saved = parse(jar, storage, hiddenKey)
  if (!saved.found) return { hidden: [], error: null }
  if (validHidden(saved.value)) return { hidden: saved.value, error: null }
  return { hidden: [], error: t('已保存的模型显示设置无效，当前显示全部模型；请重新保存。', 'Saved model visibility is invalid; all models are shown. Please save again.') }
}

export function saveSettings(weights: Weights, hidden: string[], storage: StorageAccess): string | null {
  try {
    storage().setItem(weightsKey, JSON.stringify(weights))
    storage().setItem(hiddenKey, JSON.stringify(hidden))
    return null
  } catch {
    return t('浏览器未保存设置；新设置仅在本页有效，刷新后丢失。', 'The browser did not save your settings; they apply to this page only and are lost on reload.')
  }
}
