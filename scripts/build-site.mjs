import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { resorts, queryBlockReason } from '../src/catalog.ts'

const files = ['index.html', 'favicon.svg', 'privacy.html', ...readdirSync('dist/assets').map(name => `assets/${name}`)]
const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', woff: 'font/woff', woff2: 'font/woff2' }
const assets = files.map(file => [file === 'index.html' ? '/' : `/${file}`, [types[file.split('.').at(-1)], readFileSync(`dist/${file}`).toString('base64')]])
const points = resorts.flatMap(resort => resort.points.filter(point => !queryBlockReason(resort, point)).map(point => point.id))

rmSync('dist', { recursive: true })
mkdirSync('dist/server', { recursive: true })
for (const name of readdirSync('worker')) {
  const source = readFileSync(`worker/${name}`, 'utf8')
  writeFileSync(`dist/server/${name}`, source.replace(/from '\.\.\/src\/(\w+)\.ts'/g, "from './$1.js'"))
}
for (const name of ['weather', 'catalog', 'northAmerica', 'units', 'customLocations', 'weights', 'legacyCookie']) {
  const source = readFileSync(`src/${name}.ts`, 'utf8').replace(/from '(\.\/[^']+)\.ts'/g, "from '$1.js'")
  writeFileSync(`dist/server/${name}.js`, stripTypeScriptTypes(source))
}
writeFileSync('dist/server/generated.js', `export const assets = new Map(${JSON.stringify(assets)});\nexport const points = new Set(${JSON.stringify(points)});\n`)
