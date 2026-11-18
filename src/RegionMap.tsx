import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './regions.css'

export type MapRegion = { name: string; points: string; totals: (number | null)[]; floor: number; conditions: { text: string; warm: boolean }[]; boundary: L.LatLngTuple[] }

export const boundaries = {
  '太平洋西北沿海山地': [[51.1,-124.2],[50.8,-122.4],[49.6,-121.25],[48.5,-120.65],[47.35,-120.7],[46.75,-121.4],[47.65,-122.05],[48.7,-122.35],[49.35,-123.1],[50.3,-123.85]],
  '内华达山脉': [[40.25,-121.4],[40.15,-120.6],[39.35,-119.85],[38.4,-119.35],[37.45,-118.45],[36.5,-118.05],[36.0,-118.2],[36.48,-118.85],[37.45,-119.55],[38.45,-120.43],[39.5,-121.05]],
  '加拿大哥伦比亚山系': [[52.5,-119.65],[52.45,-118.7],[51.8,-117.55],[51.1,-116.65],[50.65,-116.3],[49.55,-116.15],[49.25,-117.4],[50.1,-118.25],[51.15,-119.25]],
  '加拿大落基山脉': [[53.3,-119.75],[53.35,-118.65],[52.65,-117.35],[51.6,-115.45],[50.4,-114.45],[49.55,-114.25],[49.55,-115.05],[50.65,-116.3],[51.1,-116.65],[51.8,-117.55],[52.45,-118.7]],
  '提顿山脉': [[44.16,-110.94],[44.04,-110.76],[43.73,-110.72],[43.49,-110.78],[43.45,-111.02],[43.65,-111.18],[43.91,-111.13]],
  '蒙大拿麦迪逊山脉': [[45.52,-111.49],[45.44,-111.24],[45.22,-111.24],[44.92,-111.2],[44.76,-111.4],[45.08,-111.57],[45.35,-111.62]],
  '圣胡安山脉': [[38.16,-107.97],[38.08,-107.49],[37.78,-106.76],[37.47,-106.55],[37.28,-106.84],[37.54,-107.94],[37.82,-108.14]],
  '俄勒冈胡德山': [[45.48,-121.78],[45.44,-121.56],[45.32,-121.54],[45.25,-121.65],[45.28,-121.83],[45.38,-121.87]],
  '瓦萨奇山脉': [[41.85,-112.0],[41.75,-111.57],[41.15,-111.43],[40.6,-111.38],[39.85,-111.53],[39.75,-111.83],[40.52,-111.91],[41.2,-112.05]],
  '科罗拉多中部高地': [[40.25,-106.9],[40.05,-106.1],[39.8,-105.65],[39.28,-105.77],[38.65,-106.05],[38.7,-106.7],[39.05,-107.08],[39.65,-106.85]],
} satisfies Record<string, L.LatLngTuple[]>

const bounds = L.latLngBounds(Object.values(boundaries).flat())

const scale = [
  { min: 40, color: '#168446', label: '≥40' },
  { min: 15, color: '#8bb83e', label: '15–40' },
  { min: 1, color: '#e6b53a', label: '1–15' },
  { min: 0, color: '#d14842', label: '不足 1' },
  { min: -1, color: '#818990', label: '缺测' },
]

export function RegionMap({ rows, selected, onSelect }: { rows: MapRegion[]; selected: string | null; onSelect: (name: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  useEffect(() => {
    const m = L.map(container.current!, { scrollWheelZoom: false, zoomSnap: 0.25, minZoom: 2, maxZoom: 12 })
    map.current = m
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: '地图 © Esri 及其数据提供方',
    }).addTo(m)
    const resize = new ResizeObserver(() => { m.invalidateSize(); m.fitBounds(bounds.pad(0.12)) })
    resize.observe(container.current!)
    return () => { resize.disconnect(); m.remove(); map.current = null }
  }, [])
  useEffect(() => {
    const m = map.current!
    const layer = L.layerGroup().addTo(m)
    for (const r of rows) {
      const color = scale.find(s => r.floor >= s.min)!.color
      const picked = r.name === selected
      const shape = L.polygon(r.boundary, {
        color: '#233b37', weight: picked ? 4 : 2,
        dashArray: r.conditions.some(c => c.warm) ? '5 3' : undefined,
        fillColor: color, fillOpacity: picked ? 0.82 : 0.64,
      }).addTo(layer).on('click', () => onSelect(r.name))
      shape.bindTooltip(r.name + ' · ' + (r.floor < 0 ? '缺测' : r.floor.toFixed(1) + ' cm'), { sticky: true })
    }
    return () => { layer.remove() }
  }, [rows, selected, onSelect])
  const active = rows.find(r => r.name === selected)
  const boundary = active?.boundary
  useEffect(() => {
    if (boundary) map.current!.fitBounds(L.latLngBounds(boundary).pad(0.18))
  }, [boundary])
  return <div className="atlas"><div className="atlas-map" ref={container} aria-label="北美西部山地降雪地图" />
    <button className="atlas-reset" onClick={() => { onSelect(null); map.current!.fitBounds(bounds.pad(0.12)) }}>西部全景</button>
    <div className="atlas-caption"><div><strong>{active?.name ?? '周累计新雪'}</strong><small>{active ? active.points.split(' / ').map((p,i) => p + ' ' + (active.totals[i]?.toFixed(1) ?? '—') + ' cm，' + active.conditions[i].text).join(' · ') : '颜色取两个代表点的较低值（cm），边线为山系概略范围'}</small></div><div className="atlas-scale">{scale.slice().reverse().map(s => <span key={s.min}><i style={{background:s.color}} />{s.label}</span>)}<span className="atlas-warm">虚线：湿化或回暖风险</span></div></div>
  </div>
}
