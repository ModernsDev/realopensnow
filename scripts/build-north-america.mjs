import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'

const dir = process.argv[2]
if (!dir) throw new Error('用法：node scripts/build-north-america.mjs <dir>')
async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载失败（${response.status}）：${url}`)
  return response.json()
}
async function features(file) {
  const path = join(dir, file)
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')).features
  const data = await download(`https://tiles.openskimap.org/geojson/${file}`)
  writeFileSync(path, JSON.stringify(data))
  return data.features
}
const countries = { US: '美国', CA: '加拿大', MX: '墨西哥' }
const manual = new Set([
  '317407e2fb14035f61d6d927530f04e42b3a277b',
  '8cbbb46cdace32e91492bfe6abd8014ed16328e6',
  'ac774efde21231d04a2cd3a7b6cfd380dfcb4bef',
  '1688ce1f44c0112805d9755f31a8e82283162cfb',
])
const strip = text => text.normalize('NFKD').replace(/\p{M}/gu, '')
const slug = text => strip(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const round = n => Number(n.toFixed(5))
const all = await features('ski_areas.geojson')
const candidates = all.filter(({ properties: p }) => p.status === 'operating' && p.name?.trim() && p.activities.includes('downhill') && p.places.some(place => countries[place.iso3166_1Alpha2]))
const tzPath = join(dir, 'timezones.json')
async function timezones() {
  if (existsSync(tzPath)) return JSON.parse(readFileSync(tzPath, 'utf8'))
  const zones = {}
  for (let i = 0; i < candidates.length; i += 100) {
    if (i) await setTimeout(15000)
    const batch = candidates.slice(i, i + 100).map(({ properties, geometry }) => {
      let xy = geometry.coordinates
      while (Array.isArray(xy[0])) xy = xy[0]
      return { id: properties.id, lat: xy[1], lon: xy[0] }
    })
    const params = new URLSearchParams({ latitude: batch.map(p => p.lat).join(','), longitude: batch.map(p => p.lon).join(','), timezone: 'auto', forecast_days: '1', daily: 'snowfall_sum' })
    const response = await download(`https://api.open-meteo.com/v1/forecast?${params}`)
    const rows = Array.isArray(response) ? response : [response]
    if (rows.length !== batch.length) throw new Error('时区响应数量与坐标数量不同')
    batch.forEach(({ id, lat, lon }, j) => {
      const { timezone, elevation } = rows[j]
      if (!timezone || !Number.isFinite(elevation)) throw new Error(`时区或海拔无效：${id}`)
      zones[id] = { lat, lon, timezone, elevation }
    })
  }
  writeFileSync(tzPath, JSON.stringify(zones))
  return zones
}
const zones = await timezones()
const lifts = new Map(candidates.map(({ properties }) => [properties.id, []]))
for (const { properties: p, geometry } of await features('lifts.geojson')) {
  if (p.status !== 'operating') continue
  for (const area of p.skiAreas) {
    lifts.get(area.properties.id)?.push({ id: p.id, name: p.name || '缆车', ends: [geometry.coordinates[0], geometry.coordinates.at(-1)] })
  }
}
const nameFilter = /fermé|closed|tubing|touring|hors-piste|nordic ski|fqme|ski de fond|cat skiing|snowcat|\bh[ée]li|backcountry|terrain park|ranger district|[aà] venir|tuckerman|warfare|formerly evergreen|outdoor center/i
const areas = candidates.map(({ properties: p }) => {
  const name = p.name.split(';')[0].replace(/,\s*Q\d+\s*$/i, '').trim()
  const place = p.places.find(entry => countries[entry.iso3166_1Alpha2])
  const country = place.iso3166_1Alpha2
  const aliases = [...new Set([p.name, strip(p.name), strip(name), ...p.places.map(entry => entry.localized.en.locality)].filter(a => a && a !== name))]
  return { ...zones[p.id], osmId: p.id, name, original: p.name, key: slug(name), prefix: place.iso3166_2.toLowerCase(), country, region: place.localized.en.region, aliases, website: p.websites.find(url => /^https?:\/\//i.test(url)), lifts: lifts.get(p.id) }
})
function km(a, b) {
  const rad = Math.PI / 180
  const h = Math.sin((a.lat - b.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((a.lon - b.lon) * rad / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}
const excluded = []
const named = areas.filter(a => {
  if (!nameFilter.test(a.original.normalize('NFC'))) return true
  excluded.push(['名称', a.original, a.prefix])
  return false
})
const byCoordinates = (a, b) => a.lat - b.lat || a.lon - b.lon || compare(a.osmId, b.osmId)
const lifted = named.filter(a => a.lifts.length)
const kept = []
for (const a of named.sort((a, b) => b.lifts.length - a.lifts.length || byCoordinates(a, b))) {
  const nearby = !a.lifts.length && lifted.find(b => km(a, b) < 3)
  const duplicate = kept.find(b => b.key === a.key && km(a, b) < 5)
  if (nearby || duplicate) excluded.push([nearby ? '无缆车且邻近' : '同名邻近', a.name, a.prefix, (nearby || duplicate).name])
  else kept.push(a)
}
function points(a) {
  if (!a.lifts.length) return [['site', '雪场位置', round(a.lat), round(a.lon), Math.round(a.elevation)]]
  const ends = a.lifts.sort((a, b) => compare(a.id, b.id)).flatMap(lift =>
    lift.ends.sort((a, b) => a[2] - b[2]).map(([lon, lat, z], i) => ({ label: lift.name + (i ? ' 上站' : ' 下站'), lon, lat, z })))
  ends.sort((a, b) => a.z - b.z)
  const base = ends[0], top = ends.at(-1)
  const point = (kind, band, p) => [kind, band + ' · ' + p.label, round(p.lat), round(p.lon), Math.round(p.z)]
  const result = [point('base', '山脚', base)]
  if (Math.round(base.z) === Math.round(top.z)) return result
  const center = (base.z + top.z) / 2
  const mid = ends.reduce((a, b) => Math.abs(a.z - center) <= Math.abs(b.z - center) ? a : b)
  if (mid.z - base.z >= 60 && top.z - mid.z >= 60) result.push(point('mid', '山腰', mid))
  result.push(point('top', '山顶', top))
  return result
}
const automatic = kept.filter(a => {
  if (!manual.has(a.osmId)) return true
  excluded.push(['手工收录', a.name, a.prefix])
  return false
})
const ids = new Set()
const stem = a => a.prefix + '-' + a.key
const stems = new Set(automatic.map(stem))
const rows = automatic.sort(byCoordinates).map(a => {
  const base = stem(a)
  let id = base
  for (let i = 2; ids.has(id) || (id !== base && stems.has(id)); i++) id = base + '-' + i
  ids.add(id)
  return [id, a.name, a.country, a.region + ' · ' + countries[a.country], a.timezone, round(a.lat), round(a.lon), a.aliases, a.website ?? null, points(a)]
}).sort((a, b) => compare(a[0], b[0]))
const types = `export type NorthAmericaResort = [id: string, name: string, country: 'US' | 'CA' | 'MX', region: string, timezone: string, lat: number, lon: number, aliases: string[], website: string | null, points: [kind: 'base' | 'mid' | 'top' | 'site', name: string, lat: number, lon: number, elevation: number][]]`
writeFileSync(new URL('../src/northAmerica.ts', import.meta.url), types + '\nexport const northAmerica: NorthAmericaResort[] = [\n' + rows.map(row => JSON.stringify(row)).join(',\n') + '\n]\n')
console.log(JSON.stringify({ input: all.length, candidates: candidates.length, retained: rows.length, excluded }, null, 2))
