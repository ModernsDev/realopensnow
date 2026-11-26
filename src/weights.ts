import { defaultWeights, models, type Weights } from './weather.ts'

export const weightsCookie = 'snow-weights'
export const hiddenCookie = 'snow-hidden'
const ids = new Set(models.map(m => m.id))

export function validWeights(input: unknown): input is Weights {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).length !== models.length || Object.keys(input).some(id => !ids.has(id))) return false
  const values = Object.values(input)
  return values.every(n => Number.isInteger(n) && n >= 0 && n <= 100) && values.some(n => n !== 0)
}
export const validHidden = (input: unknown): input is string[] =>
  Array.isArray(input) && input.length < models.length && new Set(input).size === input.length && input.every(id => ids.has(id))

const readCookie = (cookie: string, name: string) => cookie.split('; ').find(part => part.startsWith(`${name}=`))?.slice(name.length + 1)
function parse(cookie: string, name: string) {
  const raw = readCookie(cookie, name)
  if (raw === undefined) return { found: false } as const
  try { return { found: true, value: JSON.parse(decodeURIComponent(raw)) as unknown } as const } catch { return { found: true, value: undefined } as const }
}

export function readWeights(cookie: string): { weights: Weights; error: string | null } {
  const saved = parse(cookie, weightsCookie)
  if (!saved.found) return { weights: defaultWeights, error: null }
  const merged = typeof saved.value === 'object' && saved.value !== null && !Array.isArray(saved.value) ? { ...defaultWeights, ...saved.value } : null
  if (validWeights(merged)) return { weights: merged, error: null }
  return { weights: defaultWeights, error: '已保存的权重无效，当前使用默认权重；请重新保存。' }
}
export function readHidden(cookie: string): { hidden: string[]; error: string | null } {
  const saved = parse(cookie, hiddenCookie)
  if (!saved.found) return { hidden: [], error: null }
  if (validHidden(saved.value)) return { hidden: saved.value, error: null }
  return { hidden: [], error: '已保存的模型显示设置无效，当前显示全部模型；请重新保存。' }
}

function write(name: string, value: unknown, target: { cookie: string }, secure: boolean) {
  const encoded = encodeURIComponent(JSON.stringify(value))
  target.cookie = `${name}=${encoded}; path=/; max-age=31536000; samesite=lax${secure ? '; secure' : ''}`
  return readCookie(target.cookie, name) === encoded
}
export function saveSettings(weights: Weights, hidden: string[], target: { cookie: string }, secure: boolean): string | null {
  const ok = [write(weightsCookie, weights, target, secure), write(hiddenCookie, hidden, target, secure)].every(Boolean)
  return ok ? null : '浏览器未保存 cookie；新设置仅在本页有效，刷新后丢失。'
}
