import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { NorthAmericaResort } from '../src/northAmerica.ts'

test('builder joins operating lift IDs, resolves collisions and reproduces the downloaded data offline', async t => {
  const dir = mkdtempSync(join(import.meta.dirname, '.na-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'src'))
  mkdirSync(join(dir, 'scripts'))
  const script = join(dir, 'scripts/build-north-america.mjs')
  copyFileSync(new URL('../scripts/build-north-america.mjs', import.meta.url), script)
  const area = (id: string, name: string, lat: number) => ({
    geometry: { type: 'Polygon', coordinates: [[[-110, lat], [-110.01, lat], [-110.01, lat + 0.01], [-110, lat]]] },
    properties: { id, name, status: 'operating', activities: ['downhill'], websites: ['ftp://example.com', 'https://example.com'],
      places: [{ iso3166_2: 'US-UT', iso3166_1Alpha2: 'US', localized: { en: { region: 'Utah', locality: 'Ville' } } }] },
  })
  const areas = [area('north', 'Écho;Echo', 45), area('small', 'Echo', 40.005), area('south', 'Echo', 40), area('near', 'At Base', 40.01), area('far', 'Col, Q123', 42)]
  const lift = (id: string, areaId: string, heights: number[], status = 'operating') => ({
    properties: { id, name: id, status, skiAreas: [{ properties: { id: areaId } }] },
    geometry: { type: 'LineString', coordinates: heights.map((z, i) => [-110, 40 + i / 100, z]) },
  })
  const lifts = [lift('flat', 'north', [99.8, 100.1]), lift('small', 'small', [10, 500]), lift('reverse', 'south', [200, 900, 0]),
    lift('mid', 'south', [100, 150]), lift('old', 'south', [-500, 500], 'abandoned'), lift('oldSite', 'far', [10, 20], 'closed')]
  const mock = `globalThis.fetch = async input => {
    const url = new URL(input)
    if (url.href === 'https://tiles.openskimap.org/geojson/lifts.geojson') return Response.json({features:${JSON.stringify(lifts)}})
    if (url.href === 'https://tiles.openskimap.org/geojson/ski_areas.geojson') return Response.json({features:${JSON.stringify(areas)}})
    if (url.origin + url.pathname !== 'https://api.open-meteo.com/v1/forecast' || url.searchParams.get('latitude') !== '45,40.005,40,40.01,42' || url.searchParams.get('longitude') !== Array(5).fill('-110').join(',') || url.searchParams.get('timezone') !== 'auto' || url.searchParams.get('forecast_days') !== '1' || url.searchParams.get('daily') !== 'snowfall_sum') throw Error(url.href)
    return Response.json(Array(5).fill({ latitude: 0, longitude: 0, timezone: 'America/Denver', elevation: 126.7 }))
  }`
  const run = (preload: string) => execFileSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), script, dir], { encoding: 'utf8' })
  assert.equal(JSON.parse(run(mock)).retained, 3)
  const file = join(dir, 'src/northAmerica.ts')
  const first = readFileSync(file)
  run('globalThis.fetch = () => { throw Error("unexpected request") }')
  assert.deepEqual(readFileSync(file), first)
  const { northAmerica: rows }: { northAmerica: NorthAmericaResort[] } = await import(pathToFileURL(file).href)
  assert.deepEqual(rows.map(r => r[0]), ['us-ut-col', 'us-ut-echo', 'us-ut-echo-2'])
  const [site, south, north] = rows
  assert.deepEqual(site[9], [['site', '雪场位置', 42, -110, 127]])
  assert.deepEqual(south[9], [
    ['base', '山脚 · reverse 下站', 40.02, -110, 0],
    ['mid', '山腰 · mid 下站', 40, -110, 100],
    ['top', '山顶 · reverse 上站', 40, -110, 200],
  ])
  assert.deepEqual(north[9], [['base', '山脚 · flat 下站', 40, -110, 100]])
  assert.equal(north[1], 'Écho')
  assert.deepEqual(north[7], ['Écho;Echo', 'Echo;Echo', 'Echo', 'Ville'])
  assert.equal(north[8], 'https://example.com')
})
