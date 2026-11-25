import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createLocation, parseCoordinates, resolveLocation, type CustomLocation } from './customLocations'

export function CustomLocationForm({ onAdd, onCancel }: { onAdd: (location: CustomLocation) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [elevation, setElevation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController>(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const coordinates = parseCoordinates(text)
    if (!coordinates) return setError('坐标无法识别。请按“纬度, 经度”填写，例如 40.588, -111.638。')
    setBusy(true)
    setError('')
    const current = controller.current = new AbortController()
    try {
      const resolved = await resolveLocation(coordinates, current.signal)
      if (current.signal.aborted) return
      onAdd(createLocation(name, coordinates, elevation ? Math.round(Number(elevation)) : resolved.elevation, resolved.timezone))
    } catch (e) {
      if (current.signal.aborted) return
      setError(e instanceof Error && e.name === 'TimeoutError' ? '天气服务请求超时，请重试。' : (e as Error).message)
      setBusy(false)
    }
  }

  const locate = () => navigator.geolocation.getCurrentPosition(
    ({ coords }) => { setText(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`); setError('') },
    e => setError(e.code === e.PERMISSION_DENIED ? '浏览器未允许定位，请手动填写坐标。' : '无法取得当前位置，请手动填写坐标。'),
    { enableHighAccuracy: true, timeout: 15000 },
  )

  return <section className="detail custom-form" aria-labelledby="custom-title">
    <h2 id="custom-title">添加自定义坐标</h2>
    <p>为雪场外的任意地点获取预报，例如野雪路线或未收录的小山。</p>
    <form onSubmit={submit}>
      <label>名称<input required maxLength={60} pattern=".*\S.*" value={name} onChange={e => setName(e.target.value)} placeholder="例如 Grizzly Gulch" /></label>
      <label>GPS 坐标<span className="field-row"><input required value={text} onChange={e => { setText(e.target.value); setError('') }} placeholder="40.588, -111.638" aria-describedby="custom-hint" /><button type="button" onClick={locate}>使用当前位置</button></span><small id="custom-hint">纬度在前，支持十进制与度分秒。可直接粘贴地图里复制的坐标。</small></label>
      <label>海拔（米，可选）<input type="number" min="-500" max="9000" step="1" value={elevation} onChange={e => setElevation(e.target.value)} /><small>留空时按坐标自动获取地形海拔。</small></label>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="field-row"><button className="primary" type="submit" disabled={busy}>{busy ? '正在查询海拔与时区…' : '添加地点'}</button><button type="button" onClick={onCancel}>取消</button></div>
      <p className="muted">地点保存在本机浏览器。坐标会发送给 Open-Meteo 以获取海拔、时区和预报。</p>
    </form>
  </section>
}
