import { t } from './i18n.ts'
import type { CustomLocation } from './customLocations'
import type { Units } from './units'
import type { Weights } from './weather'

export type Account = { name: string; email: string; image: string | null }
export type UserData = { favorites: string[]; customLocations: CustomLocation[]; weights: Weights; hidden: string[]; units: Units }

export const accountsEnabled = import.meta.env.VITE_HOSTED_FORECAST === '1'

export async function loadAccount(): Promise<{ user: Account; data: UserData | null } | null> {
  const response = await fetch('/api/me', { credentials: 'same-origin' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error(t(`读取账户失败（${response.status}）`, `Could not load your account (${response.status})`))
  return response.json()
}

export async function saveUserData(data: UserData): Promise<string | null> {
  try {
    const response = await fetch('/api/me', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
    return response.ok ? null : t(`云端保存失败（${response.status}）；更改仅保存在本机。`, `Cloud save failed (${response.status}); changes are saved on this device only.`)
  } catch {
    return t('云端保存失败（网络错误）；更改仅保存在本机。', 'Cloud save failed (network error); changes are saved on this device only.')
  }
}

export async function signIn() {
  const response = await fetch('/api/auth/sign-in/social', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'google', callbackURL: location.pathname + location.hash }) })
  const body = await response.json().catch(() => null)
  if (!response.ok || typeof body?.url !== 'string') throw new Error(t(`无法开始 Google 登录（${response.status}）`, `Could not start Google sign-in (${response.status})`))
  location.href = body.url
}

export async function signOut() {
  const response = await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
  if (!response.ok) throw new Error(t(`退出失败（${response.status}）`, `Sign-out failed (${response.status})`))
}
