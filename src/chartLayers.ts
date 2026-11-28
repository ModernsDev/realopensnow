export type ChartLayers = { quality: boolean; agreement: boolean; range: boolean }
export const defaultChartLayers: ChartLayers = { quality: true, agreement: true, range: true }
const key = 'snow-chart-layers'
export const validChartLayers = (input: unknown): input is ChartLayers => typeof input === 'object' && input !== null && Object.keys(input).length === 3 &&
  (Object.keys(defaultChartLayers) as (keyof ChartLayers)[]).every(k => typeof (input as Record<string, unknown>)[k] === 'boolean')
export function readChartLayers(storage: () => Storage): ChartLayers {
  try {
    const parsed: unknown = JSON.parse(storage().getItem(key) ?? '')
    if (validChartLayers(parsed)) return parsed
  } catch {}
  return defaultChartLayers
}
export const saveChartLayers = (layers: ChartLayers, storage: () => Storage) => storage().setItem(key, JSON.stringify(layers))
