import { t } from './i18n.ts'
import { takeLegacyCookie, type CookieJar } from './legacyCookie.ts'

export const favoritesKey = 'snow-favorites'
const defaults = ['alta', 'snowbird', 'niseko', 'chamonix']
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>
export type FavoritesState = { ids: string[]; error: string | null }

export function readFavorites(jar: CookieJar, storage: StorageAccess, validIds: Set<string>): FavoritesState {
  let raw: string | null
  try {
    takeLegacyCookie(jar, favoritesKey, value => storage().setItem(favoritesKey, JSON.stringify(value ? value.split('.') : [])))
    raw = storage().getItem(favoritesKey)
  } catch {
    return { ids: [], error: t('无法读取本机收藏（存储不可用）。当前列表为空；请允许网站存储后重试保存。', 'Could not read favorites on this device (storage unavailable). The list is empty; allow site storage and retry saving.') }
  }
  if (raw === null) return { ids: [...defaults], error: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string')) throw new Error('invalid favorites')
    const ids = [...new Set(parsed as string[])].filter(id => validIds.has(id))
    return { ids, error: ids.length === parsed.length ? null : t('收藏含重复或已失效记录，已按当前目录整理；请保存收藏以更新记录。', 'Duplicate or outdated favorites were cleaned up against the current catalog. Save favorites to update the stored list.') }
  } catch {
    return { ids: [], error: t('本机收藏记录损坏。当前列表为空；可重新收藏并重试保存。', 'Favorites on this device are corrupted. The list is empty; add favorites again and retry saving.') }
  }
}

export function saveFavorites(favorites: string[], storage: StorageAccess, validIds: Set<string>): string | null {
  try {
    storage().setItem(favoritesKey, JSON.stringify([...new Set(favorites.filter(id => validIds.has(id)))]))
    return null
  } catch {
    return t('无法保存本机收藏；当前更改仅在本页有效，刷新后可能丢失。请允许网站存储后重试保存。', 'Could not save favorites on this device; changes apply to this page only and may be lost on reload. Allow site storage and retry.')
  }
}
