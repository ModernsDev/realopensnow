export function renewedFavoritesCookie(header) {
  const value = header?.match(/(?:^|;\s*)snow-favorites=([a-z0-9.-]{0,1024})(?:;|$)/)?.[1]
  return value === undefined ? null : `snow-favorites=${value}; Path=/; Max-Age=34560000; SameSite=Lax; Secure`
}
