import { defaultWeights, models, type Weights } from './weather.ts'

export const weightsCookie = 'snow-weights'

export function validWeights(input: unknown): input is Weights {
  if (typeof input !== 'object' || input === null || Object.keys(input).length !== models.length) return false
  const values = models.map(m => (input as Record<string, unknown>)[m.id])
  return values.every(n => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100) && values.some(n => n !== 0)
}

const readCookie = (cookie: string) => cookie.split('; ').find(part => part.startsWith(`${weightsCookie}=`))?.slice(weightsCookie.length + 1)

export function readWeights(cookie: string): { weights: Weights; error: string | null } {
  const raw = readCookie(cookie)
  if (raw === undefined) return { weights: defaultWeights, error: null }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw))
    if (validWeights(parsed)) return { weights: parsed, error: null }
  } catch {}
  return { weights: defaultWeights, error: '已保存的权重无效，当前使用默认权重；请重新保存。' }
}

export function saveWeights(weights: Weights, target: { cookie: string }, secure: boolean): string | null {
  const encoded = encodeURIComponent(JSON.stringify(weights))
  target.cookie = `${weightsCookie}=${encoded}; path=/; max-age=31536000; samesite=lax${secure ? '; secure' : ''}`
  return readCookie(target.cookie) === encoded ? null : '浏览器未保存 cookie；新权重仅在本页有效，刷新后丢失。'
}
