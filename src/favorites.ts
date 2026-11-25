export const favoritesKey = 'snow-favorites'
const defaults = ['alta', 'snowbird', 'niseko', 'chamonix']
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>
export type FavoritesState = { ids: string[]; error: string | null }

export function readFavorites(storage: StorageAccess, validIds: Set<string>): FavoritesState {
  try {
    const raw = storage().getItem(favoritesKey)
    if (raw === null) return { ids: [...defaults], error: null }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string')) throw new Error('invalid favorites')
    const valid = [...new Set(parsed.filter(id => validIds.has(id)))]
    return { ids: valid, error: valid.length === parsed.length ? null : '本机收藏含重复或已失效记录，已按当前目录整理；请保存收藏以更新本机记录。' }
  } catch {
    return { ids: [], error: '无法读取本机收藏（存储不可用或记录损坏）。当前列表为空；可重新收藏并重试保存。' }
  }
}

export function saveFavorites(favorites: string[], storage: StorageAccess, validIds: Set<string>): string | null {
  try {
    storage().setItem(favoritesKey, JSON.stringify([...new Set(favorites.filter(id => validIds.has(id)))]))
    return null
  } catch {
    return '无法保存本机收藏；当前更改仅在本页有效，刷新后可能丢失。请允许网站存储后重试保存。'
  }
}
