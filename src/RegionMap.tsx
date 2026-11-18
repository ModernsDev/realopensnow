import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './regions.css'

export type MapRegion = { name: string; points: string; totals: (number | null)[]; floor: number; center: L.LatLngTuple }

const scale = [
  { min: 40, color: '#6931a5', label: '≥40' },
  { min: 15, color: '#155da6', label: '15–40' },
  { min: 1, color: '#12857c', label: '1–15' },
  { min: 0, color: '#496274', label: '<1' },
  { min: -1, color: '#818990', label: '缺测' },
]

export function RegionMap({ centers, rows, selected, onSelect }: { centers: L.LatLngTuple[]; rows: MapRegion[]; selected: string | null; onSelect: (name: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const bounds = useMemo(() => L.latLngBounds(centers), [centers])
  useEffect(() => {
    const m = L.map(container.current!, { scrollWheelZoom: false, zoomSnap: 0.25, minZoom: 2, maxZoom: 12 })
    map.current = m
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: '地图 © Esri 及其数据提供方',
    }).addTo(m)
    const resize = new ResizeObserver(() => { m.invalidateSize(); m.fitBounds(bounds.pad(0.12)) })
    resize.observe(container.current!)
    return () => { resize.disconnect(); m.remove(); map.current = null }
  }, [bounds])
  useEffect(() => {
    const m = map.current!
    const layer = L.layerGroup().addTo(m)
    for (const r of rows) {
      const dot = L.marker(r.center, { title: r.name, alt: r.name, icon: L.divIcon({
        className: 'snow-marker', iconSize: [28, 28], iconAnchor: [14, 14],
        html: '<span style="background:' + scale.find(s => r.floor >= s.min)!.color + '">' + (r.floor < 0 ? '–' : Math.round(r.floor)) + '</span>',
      }) }).addTo(layer).on('click', () => onSelect(r.name))
      if (r.name === selected) dot.bindTooltip(r.name, { permanent: true, direction: 'top', offset: [0, -12] }).openTooltip()
    }
    return () => { layer.remove() }
  }, [rows, selected, onSelect])
  const active = rows.find(r => r.name === selected)
  const center = active?.center
  useEffect(() => {
    if (center) map.current!.setView(center, 7)
  }, [center])
  return <div className="atlas"><div className="atlas-map" ref={container} aria-label="北美山地区域降雪地图" />
    <button className="atlas-reset" onClick={() => { onSelect(null); map.current!.fitBounds(bounds.pad(0.12)) }}>全域视图</button>
    <div className="atlas-caption"><div><strong>{active?.name ?? '周累计新雪'}</strong><small>{active ? active.points.split(' / ').map((p,i) => p + ' ' + (active.totals[i]?.toFixed(1) ?? '—') + ' cm').join(' · ') : '标记取两个代表点的较低值，单位 cm'}</small></div><div className="atlas-scale">{scale.slice().reverse().map(s => <span key={s.min}><i style={{background:s.color}} />{s.label}</span>)}</div></div>
  </div>
}
