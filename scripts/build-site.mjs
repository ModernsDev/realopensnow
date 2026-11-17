import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resorts, queryBlockReason } from '../src/catalog.ts'
import { forecastSource } from '../src/weather.ts'

const files = ['index.html', 'favicon.svg', ...readdirSync('dist/assets').map(name => `assets/${name}`)]
const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml', png: 'image/png' }
const assets = files.map(file => [file === 'index.html' ? '/' : `/${file}`, [types[file.split('.').at(-1)], readFileSync(`dist/${file}`).toString('base64')]])
const points = resorts.flatMap(resort => resort.points.filter(point => !queryBlockReason(resort, point)).map(point => {
  const { lat, lon } = point.coordinates.value
  return [point.id, { id: point.id, timezone: resort.timezone, source: forecastSource(lat, lon, point.elevation.value, resort.timezone) }]
}))
if (points.length > 20 || new Map(points).size !== points.length) throw new Error('Forecast quota assumes at most 20 distinct points')

rmSync('dist', { recursive: true })
mkdirSync('dist/server', { recursive: true })
copyFileSync('worker/index.js', 'dist/server/index.js')
writeFileSync('dist/server/weather.js', `export const localDate = ${(await import('../src/weather.ts')).localDate.toString()};\n`)
writeFileSync('dist/server/generated.js', `export const assets = new Map(${JSON.stringify(assets)});\nexport const points = new Map(${JSON.stringify(points)});\n`)
