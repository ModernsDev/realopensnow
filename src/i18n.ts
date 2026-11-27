export type Lang = 'zh' | 'en'
export const langKey = 'snow-lang'

export function detectLang(saved: string | null, preferred: readonly string[]): Lang {
  if (saved === 'zh' || saved === 'en') return saved
  return preferred[0]?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const readSaved = () => { try { return localStorage.getItem(langKey) } catch { return null } }
export const lang: Lang = typeof window === 'undefined' ? 'zh' : detectLang(readSaved(), navigator.languages?.length ? navigator.languages : [navigator.language])
export const en = lang === 'en'
export const t = (zh: string, english: string) => en ? english : zh

export function setLang(next: Lang) {
  try { localStorage.setItem(langKey, next) } catch { return t('浏览器未保存语言设置；请允许网站存储后重试。', 'The browser did not save the language; allow site storage and try again.') }
  if (next !== lang) location.reload()
  return null
}

const countries: Record<string, string> = { 美国: 'USA', 加拿大: 'Canada', 墨西哥: 'Mexico', 日本: 'Japan', 法国: 'France' }
export const regionName = (region: string) => en ? region.replace(/[一-鿿]+/g, c => countries[c] ?? c) : region
const bands: Record<string, string> = { 山脚: 'Base', 山腰: 'Mid', 山顶: 'Summit', 雪场位置: 'Resort location', 附近参考: 'Nearby reference' }
export const pointName = (name: string) => en ? name.replace(/^(山脚|山腰|山顶|雪场位置|附近参考)/, b => bands[b]).replace(/ 下站$/, ' (bottom)').replace(/ 上站$/, ' (top)').replace(/ 中站$/, ' (mid)').replace(/ 转角站$/, ' (angle)').replace('· 缆车 ', '· Lift ') : name
