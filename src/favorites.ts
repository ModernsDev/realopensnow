export const favoritesKey = 'snow-favorites'
const defaults = ['alta', 'snowbird', 'niseko', 'chamonix']
type CookieJar = { cookie: string }
type StorageAccess = () => Pick<Storage, 'getItem' | 'removeItem'>
export type FavoritesState = { ids: string[]; error: string | null }

const readCookie = (jar: CookieJar) => jar.cookie.split('; ').find(c => c.startsWith(`${favoritesKey}=`))?.slice(favoritesKey.length + 1)

export function readFavorites(jar: CookieJar, legacy: StorageAccess, validIds: Set<string>): FavoritesState {
  try {
    const value = readCookie(jar)
    if (value !== undefined) return normalize(value ? value.split('.') : [], validIds)
  } catch {
    return { ids: [], error: '无法读取追踪清单 cookie。当前列表为空；请允许网站 cookie 后重试保存。' }
  }
  let state: FavoritesState
  try {
    const raw = legacy().getItem(favoritesKey)
    if (raw === null) return { ids: [...defaults], error: null }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string')) throw new Error('invalid favorites')
    state = normalize(parsed, validIds)
  } catch {
    return { ids: [], error: '无法读取旧版本机收藏（存储不可用或记录损坏）。当前列表为空；可重新收藏并重试保存。' }
  }
  const error = saveFavorites(state.ids, jar, validIds)
  if (error) return { ids: state.ids, error }
  legacy().removeItem(favoritesKey)
  return state
}

function normalize(list: string[], validIds: Set<string>): FavoritesState {
  const valid = [...new Set(list.filter(id => validIds.has(id)))]
  return { ids: valid, error: valid.length === list.length ? null : '追踪清单含重复或已失效记录，已按当前目录整理；请保存收藏以更新记录。' }
}

export function saveFavorites(favorites: string[], jar: CookieJar, validIds: Set<string>, secure = globalThis.location?.protocol === 'https:'): string | null {
  const failure = '无法保存追踪清单 cookie；当前更改仅在本页有效，刷新后可能丢失。请允许网站 cookie 后重试保存。'
  try {
    const value = [...new Set(favorites.filter(id => validIds.has(id)))].join('.')
    jar.cookie = `${favoritesKey}=${value}; Path=/; Max-Age=34560000; SameSite=Lax${secure ? '; Secure' : ''}`
    return readCookie(jar) === value ? null : failure
  } catch {
    return failure
  }
}
