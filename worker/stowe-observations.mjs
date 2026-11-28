export const stoweObservationPath = '/api/observations/stowe'
const source = 'https://api2.cocorahs.org/api/DailyPrecipObs?stationField=StationNumber&stationFieldValue=VT-WS-19&sortField=ObsDateTime&sortDir=DESC&units=US'

async function stoweDailyReports(limit) {
  const upstream = await fetch(`${source}&limit=${limit}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
  if (!upstream.ok) throw new Error(`CoCoRaHS HTTP ${upstream.status}`)
  const { results } = await upstream.json()
  if (!Array.isArray(results)) throw new Error('CoCoRaHS 返回格式异常')
  return results
}

export async function stoweObservations() {
  try {
    const results = await stoweDailyReports(1)
    const row = results[0]
    if (row && (row.stationNumber !== 'VT-WS-19' || row.units !== 'english')) return Response.json(null, { status: 502 })
    const { obsDateTime, depthOfSnowfall, depthOfSnowfallIsTrace, depthOfSnowOnGround, depthOfSnowOnGroundIsTrace } = row ?? {}
    return Response.json(row ? { obsDateTime, depthOfSnowfall, depthOfSnowfallIsTrace, depthOfSnowOnGround, depthOfSnowOnGroundIsTrace } : null,
      { headers: { 'cache-control': 'public, max-age=300' } })
  } catch {
    return Response.json(null, { status: 502 })
  }
}
