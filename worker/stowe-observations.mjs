export const stoweObservationPath = '/api/observations/stowe'
const source = 'https://api2.cocorahs.org/api/DailyPrecipObs?stationField=StationNumber&stationFieldValue=VT-WS-19&limit=1&sortField=ObsDateTime&sortDir=DESC&units=US'

export async function stoweObservations() {
  try {
    const upstream = await fetch(source, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    if (!upstream.ok) return Response.json(null, { status: 502 })
    const { results } = await upstream.json()
    const row = results[0]
    if (row && (row.stationNumber !== 'VT-WS-19' || row.units !== 'english')) return Response.json(null, { status: 502 })
    const { obsDateTime, depthOfSnowfall, depthOfSnowfallIsTrace, depthOfSnowOnGround, depthOfSnowOnGroundIsTrace } = row ?? {}
    return Response.json(row ? { obsDateTime, depthOfSnowfall, depthOfSnowfallIsTrace, depthOfSnowOnGround, depthOfSnowOnGroundIsTrace } : null,
      { headers: { 'cache-control': 'public, max-age=300' } })
  } catch {
    return Response.json(null, { status: 502 })
  }
}
