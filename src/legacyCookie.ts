export type CookieJar = { cookie: string }

export function takeLegacyCookie(jar: CookieJar, name: string, migrate: (value: string) => void) {
  const value = jar.cookie.split('; ').find(part => part.startsWith(`${name}=`))?.slice(name.length + 1)
  if (value === undefined) return
  migrate(value)
  jar.cookie = `${name}=; Path=/; Max-Age=0`
}
