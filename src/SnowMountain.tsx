import { useEffect, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, Mesh, PerspectiveCamera, PlaneGeometry, Points, Scene, ShaderMaterial, Vector3, WebGLRenderer } from 'three'
import { columns, rows, spanX, spanZ, sun, type Terrain } from './terrain'

const haze = new Color('#e9f3fa').convertLinearToSRGB()

const mountainMaterial = () => new ShaderMaterial({
  uniforms: { sun: { value: new Vector3(...sun).normalize() }, haze: { value: haze } },
  vertexShader: `
    attribute float light;
    varying vec3 vWorld, vNormal;
    varying float vLight, vDepth;
    void main() {
      vWorld = position;
      vNormal = normal;
      vLight = light;
      vec4 view = modelViewMatrix * vec4(position, 1.0);
      vDepth = -view.z;
      gl_Position = projectionMatrix * view;
    }`,
  fragmentShader: `
    uniform vec3 sun, haze;
    varying vec3 vWorld, vNormal;
    varying float vLight, vDepth;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
    }
    float fbm(vec2 p) { return noise(p) * 0.5 + noise(p * 2.1) * 0.28 + noise(p * 4.3) * 0.15 + noise(p * 8.7) * 0.07; }
    void main() {
      vec3 n = normalize(vNormal);
      vec2 p = vWorld.xz + vWorld.y * vec2(0.31, 0.47);
      float e = 0.03, base = fbm(p * 5.0);
      vec3 bump = vec3(fbm((p + vec2(e, 0)) * 5.0) - base, 0.0, fbm((p + vec2(0, e)) * 5.0) - base) / e;
      float steep = 1.0 - n.y;
      n = normalize(n - bump * mix(0.03, 0.13, smoothstep(0.15, 0.5, steep)));
      float rock = smoothstep(0.36, 0.5, 1.0 - n.y + (base - 0.5) * 0.28 - smoothstep(2.0, 5.0, vWorld.y) * 0.05);
      float strata = noise(vec2(vWorld.y * 9.0 + base * 4.0, vWorld.x * 0.8));
      vec3 stone = mix(vec3(0.29, 0.34, 0.41), vec3(0.50, 0.53, 0.57), strata * 0.6 + base * 0.4);
      vec3 ground = mix(vec3(0.97, 0.985, 1.0), stone, rock);
      float patchy = fbm(vWorld.xz * 1.1 + 7.0), trees = noise(vWorld.xz * vec2(14.0, 9.0));
      float forest = (1.0 - smoothstep(0.85, 1.5, vWorld.y + (patchy - 0.5) * 1.4)) * smoothstep(0.34, 0.56, patchy) * mix(0.55, 1.0, trees);
      ground = mix(ground, vec3(0.36, 0.47, 0.51), forest * 0.62);
      float direct = smoothstep(-0.05, 1.0, dot(n, sun)) * smoothstep(0.0, 1.0, vLight);
      float sky = 0.5 + 0.5 * n.y;
      vec3 color = ground * (vec3(0.43, 0.57, 0.77) * (0.7 + 0.3 * sky) + vec3(0.56, 0.45, 0.28) * direct);
      float distanceFog = smoothstep(17.0, 34.0, vDepth) * 0.62;
      float valley = (1.0 - smoothstep(0.2, 1.7, vWorld.y + (patchy - 0.5) * 0.8)) * smoothstep(9.0, 20.0, vDepth) * 0.6;
      gl_FragColor = vec4(mix(color, haze, clamp(distanceFog + valley, 0.0, 0.94)), 1.0);
    }`,
})

const snowMaterial = () => new ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { time: { value: 0 }, pixels: { value: 1 } },
  vertexShader: `
    uniform float time, pixels;
    attribute float size;
    varying float vAlpha;
    void main() {
      vec3 p = position;
      p.y = mod(p.y - time * (0.22 + size * 0.2), 6.0);
      p.x += sin(time * 0.4 + position.z * 3.0) * 0.25;
      vec4 view = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * view;
      gl_PointSize = pixels * (1.0 + size * 1.8) * 9.0 / -view.z;
      vAlpha = smoothstep(0.0, 0.8, p.y) * (0.45 + size * 0.5);
    }`,
  fragmentShader: `
    varying float vAlpha;
    void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5))); }`,
})

function mountScene(canvas: HTMLCanvasElement, terrain: Terrain) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
  const scene = new Scene()
  const camera = new PerspectiveCamera(17, 1, 1, 60)

  const ground = new PlaneGeometry(spanX, spanZ, columns - 1, rows - 1).rotateX(-Math.PI / 2)
  const position = ground.getAttribute('position')
  terrain.height.forEach((y, i) => position.setY(i, y))
  ground.setAttribute('light', new BufferAttribute(terrain.light, 1))
  ground.computeVertexNormals()
  const mountain = mountainMaterial()
  scene.add(new Mesh(ground, mountain))

  const flakes = 900
  const points = new Float32Array(flakes * 3).map((_, i) => i % 3 === 0 ? (Math.random() - 0.5) * 26 : i % 3 === 1 ? Math.random() * 6 : 4 + Math.random() * 10)
  const snowfall = new BufferGeometry()
  snowfall.setAttribute('position', new BufferAttribute(points, 3))
  snowfall.setAttribute('size', new BufferAttribute(new Float32Array(flakes).map(() => Math.random()), 1))
  const snow = snowMaterial()
  const drifting = new Points(snowfall, snow)
  drifting.frustumCulled = false
  scene.add(drifting)

  const still = matchMedia('(prefers-reduced-motion: reduce)')
  let frame = 0, visible = true, last = 0, pointer = 0, drift = 0
  const draw = (now: number) => {
    const time = still.matches ? 0 : now / 1000
    drift += ((still.matches ? 0 : pointer) - drift) * 0.04
    const narrow = camera.aspect < 2.6
    camera.position.set((narrow ? 5 : 3) + Math.sin(time * 0.06) * 1.1 + drift * 0.9, 2.9, 21)
    camera.lookAt((narrow ? 5 : 3) + drift * 0.2, 2.35, 0)
    snow.uniforms.time.value = time
    renderer.render(scene, camera)
  }
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop)
    if (now - last < 32) return
    last = now
    draw(now)
  }
  const restart = () => {
    cancelAnimationFrame(frame)
    if (still.matches) draw(0)
    else if (visible) frame = requestAnimationFrame(loop)
  }
  const onPointer = (event: PointerEvent) => { pointer = event.clientX / innerWidth * 2 - 1 }
  const resize = new ResizeObserver(() => {
    const { clientWidth, clientHeight } = canvas
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(clientWidth, clientHeight, false)
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
    snow.uniforms.pixels.value = renderer.getPixelRatio() * clientHeight / 100
    draw(performance.now())
  })
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; restart() })
  resize.observe(canvas)
  visibility.observe(canvas)
  still.addEventListener('change', restart)
  window.addEventListener('pointermove', onPointer)
  return () => {
    cancelAnimationFrame(frame)
    resize.disconnect()
    visibility.disconnect()
    still.removeEventListener('change', restart)
    window.removeEventListener('pointermove', onPointer)
    for (const resource of [ground, mountain, snowfall, snow, renderer]) resource.dispose()
  }
}

export default function SnowMountain() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const canvas = document.createElement('canvas')
    host.current!.append(canvas)
    let dispose = () => {}
    const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<Terrain>) => {
      worker.terminate()
      dispose = mountScene(canvas, data)
      canvas.className = 'ready'
    }
    return () => {
      worker.terminate()
      dispose()
      canvas.remove()
    }
  }, [])
  return <div className="snow-mountain" ref={host} aria-hidden="true" />
}
