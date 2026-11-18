import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './regions.css'

export type MapRegion = { name: string; points: string; totals: (number | null)[]; floor: number; conditions: { text: string; qualities: SnowQuality[] }[]; boundary: L.LatLngTuple[] }

export const boundaries = {
  '太平洋西北沿海山地': [[51.1,-124.2],[50.8,-122.4],[49.6,-121.25],[48.5,-120.65],[47.35,-120.7],[46.75,-121.4],[47.65,-122.05],[48.7,-122.35],[49.35,-123.1],[50.3,-123.85]],
  '内华达山脉': [[40.25,-121.4],[40.15,-120.6],[39.35,-119.85],[38.4,-119.35],[37.45,-118.45],[36.5,-118.05],[36.0,-118.2],[36.48,-118.85],[37.45,-119.55],[38.45,-120.43],[39.5,-121.05]],
  '加拿大哥伦比亚山系': [[52.5,-119.65],[52.45,-118.7],[51.8,-117.55],[51.1,-116.65],[50.65,-116.3],[49.55,-116.15],[49.25,-117.4],[50.1,-118.25],[51.15,-119.25]],
  '加拿大落基山脉': [[53.3,-119.75],[53.35,-118.65],[52.65,-117.35],[51.6,-115.45],[50.4,-114.45],[49.55,-114.25],[49.55,-115.05],[50.65,-116.3],[51.1,-116.65],[51.8,-117.55],[52.45,-118.7]],
  '提顿山脉': [[44.40,-111.22],[44.27,-110.58],[43.84,-110.39],[43.32,-110.52],[43.19,-111.07],[43.52,-111.51],[44.04,-111.46]],
  '蒙大拿麦迪逊山脉': [[45.52,-111.49],[45.44,-111.24],[45.22,-111.24],[44.92,-111.2],[44.76,-111.4],[45.08,-111.57],[45.35,-111.62]],
  '圣胡安山脉': [[38.16,-107.97],[38.08,-107.49],[37.78,-106.76],[37.47,-106.55],[37.28,-106.84],[37.54,-107.94],[37.82,-108.14]],
  '俄勒冈胡德山': [[45.66,-121.93],[45.57,-121.45],[45.24,-121.34],[45.05,-121.65],[45.17,-122.03],[45.43,-122.09]],
  '瓦萨奇山脉': [[41.85,-112.0],[41.75,-111.57],[41.15,-111.43],[40.6,-111.38],[39.85,-111.53],[39.75,-111.83],[40.52,-111.91],[41.2,-112.05]],
  '科罗拉多中部高地': [[40.25,-106.9],[40.05,-106.1],[39.8,-105.65],[39.28,-105.77],[38.65,-106.05],[38.7,-106.7],[39.05,-107.08],[39.65,-106.85]],
} satisfies Record<string, L.LatLngTuple[]>

const bounds = L.latLngBounds(Object.values(boundaries).flat())

export const snowQuality = {
  powder: { name: '普通粉', mark: '❄' },
  cement: { name: '水泥粉', mark: '●' },
  mix: { name: '冰水混合', mark: '☂' },
}
export type SnowQuality = keyof typeof snowQuality

const labelNames: Record<string, string> = {
  '太平洋西北沿海山地': '太平洋西北',
  '提顿山脉': '提顿山脉 · JH',
  '加拿大哥伦比亚山系': '哥伦比亚山系',
  '加拿大落基山脉': '加拿大落基',
  '蒙大拿麦迪逊山脉': '麦迪逊山脉',
  '科罗拉多中部高地': '科罗拉多中部',
}

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
    m.fitBounds(bounds.pad(0.12))
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
    const labels: { anchor: L.LatLng; tooltip: L.Tooltip; leader: L.Polyline }[] = []
    for (const r of rows) {
      const color = scale.find(s => r.floor >= s.min)!.color
      const picked = r.name === selected
      const shape = L.polygon(r.boundary, {
        color: '#233b37', weight: picked ? 4 : 2,
        fillColor: color, fillOpacity: picked ? 0.82 : 0.64,
      }).addTo(layer).on('click', () => onSelect(r.name))
      const qualities = new Set(r.conditions.flatMap(c => c.qualities))
      const caption = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = labelNames[r.name] ?? r.name
      const detail = document.createElement('span')
      detail.className = 'region-snow-total'
      detail.textContent = r.floor < 0 ? '—' : r.floor.toFixed(1) + ' cm'
      caption.append(title, detail)
      if (qualities.size) {
        const status = document.createElement('span')
        status.className = 'region-quality-status'
        for (const quality of qualities) {
          const icon = document.createElement('i')
          icon.className = 'snow-quality-icon ' + quality
          icon.textContent = snowQuality[quality].mark
          status.append(icon)
        }
        status.title = [...qualities].map(q => snowQuality[q].name).join('、')
        caption.append(status)
      }
      const anchor = shape.getCenter()
      const tooltip = L.tooltip({
        permanent: true, interactive: true, className: 'region-map-label', direction: 'center',
      }).setLatLng(anchor).setContent(caption).addTo(layer)
      tooltip.on('click', event => {
        L.DomEvent.stopPropagation(event.originalEvent)
        onSelect(r.name)
      })
      const leader = L.polyline([anchor, anchor], { color: '#233b37', weight: 1, interactive: false }).addTo(layer)
      labels.push({ anchor, tooltip, leader })
    }
    const placeLabels = () => {
      const size = m.getSize()
      const occupied = [L.bounds([0, 0], [44, 82]), L.bounds([size.x - 112, 0], [size.x, 54])]
      for (const { anchor, tooltip, leader } of labels) {
        const origin = m.latLngToContainerPoint(anchor)
        const element = tooltip.getElement()!
        const half = L.point(element.offsetWidth / 2 + 3, element.offsetHeight / 2 + 3)
        let position = origin
        if (L.bounds([0, 0], size).contains(origin)) {
          search: for (let distance = 0; distance <= Math.max(size.x, size.y); distance += 8) {
            const steps = distance ? 16 : 1
            for (let step = 0; step < steps; step++) {
              const angle = step * 2 * Math.PI / steps
              const candidate = origin.add([Math.cos(angle) * distance, Math.sin(angle) * distance])
              const box = L.bounds(candidate.subtract(half), candidate.add(half))
              if (!L.bounds([3, 3], size.subtract([3, 18])).contains(box) || occupied.some(other => other.intersects(box))) continue
              occupied.push(box)
              position = candidate
              break search
            }
          }
        }
        const target = m.containerPointToLatLng(position)
        tooltip.setLatLng(target)
        leader.setLatLngs([anchor, target])
      }
    }
    placeLabels()
    m.on('moveend resize', placeLabels)
    return () => { m.off('moveend resize', placeLabels); layer.remove() }
  }, [rows, selected, onSelect])
  const active = rows.find(r => r.name === selected)
  const boundary = active?.boundary
  useEffect(() => {
    if (boundary) map.current!.fitBounds(L.latLngBounds(boundary).pad(0.18))
  }, [boundary])
  return <div className="atlas"><div className="atlas-map" ref={container} aria-label="北美西部山地降雪地图" />
    <button className="atlas-reset" onClick={() => { onSelect(null); map.current!.fitBounds(bounds.pad(0.12)) }}>西部全景</button>
    <div className="atlas-caption"><div><strong>{active?.name ?? '周累计新雪'}</strong><small>{active ? active.points.split(' / ').map((p,i) => p + ' ' + (active.totals[i]?.toFixed(1) ?? '—') + ' cm，' + active.conditions[i].text).join(' · ') : '颜色取两个代表点的较低值（cm），边线为山系概略范围'}</small></div><div className="atlas-scale atlas-snow" role="group" aria-label="周累计新雪"><strong>周累计新雪（cm）</strong>{scale.slice().reverse().map(s => <span key={s.min}><i style={{background:s.color}} />{s.label}</span>)}</div><div className="atlas-scale atlas-quality" role="group" aria-label="雪质倾向"><strong>雪质倾向</strong>{Object.entries(snowQuality).map(([kind, q]) => <span key={kind}><i className={`snow-quality-icon ${kind}`} aria-hidden="true">{q.mark}</i>{q.name}</span>)}</div></div>
  </div>
}
