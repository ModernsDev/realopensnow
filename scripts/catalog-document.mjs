import { createHash } from 'node:crypto'
import { queryBlockReason, resorts, waterburyPoint } from '../src/catalog.ts'
import { regions } from '../src/regionSamples.ts'

export function catalogDocument() {
  const document = {
    resorts: resorts.map(resort => ({
      id: resort.id,
      timezone: resort.timezone,
      points: resort.points.filter(point => !queryBlockReason(resort, point)).map(point => ({ id: point.id, lat: point.coordinates.value.lat, lon: point.coordinates.value.lon, elevation: point.elevation.value })),
    })).filter(resort => resort.points.length),
    waterbury: waterburyPoint.id,
    regions: regions.flatMap(r => [[r[2], r[3]], [r[4], r[5]]]),
  }
  const digest = createHash('sha256').update(JSON.stringify(document)).digest('hex')
  return { digest, ...document }
}
