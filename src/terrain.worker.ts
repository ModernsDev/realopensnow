import { columns, rows, spanX, spanZ, sun } from './terrain'

let seed = 20261126
const random = () => {
  seed = seed + 0x6d2b79f5 | 0
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
  return ((t ^ t >>> 14) >>> 0) / 4294967296
}
const hash = new Float32Array(65536).map(() => random() * Math.PI * 2)
const corner = (x: number, y: number, dx: number, dy: number) => {
  const a = hash[(x & 255) << 8 | y & 255]
  return Math.cos(a) * dx + Math.sin(a) * dy
}
const noise = (x: number, y: number) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const a = corner(ix, iy, fx, fy), b = corner(ix + 1, iy, fx - 1, fy)
  const c = corner(ix, iy + 1, fx, fy - 1), d = corner(ix + 1, iy + 1, fx - 1, fy - 1)
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4
}
const ridged = (x: number, y: number) => {
  let sum = 0, amplitude = 0.5, weight = 1
  for (let i = 0; i < 7; i++) {
    const n = (1 - Math.abs(noise(x, y))) ** 2 * weight
    weight = Math.min(1, n * 1.7)
    sum += n * amplitude
    amplitude *= 0.48
    const px = x * 1.62 - y * 1.18 + 17.3
    y = x * 1.18 + y * 1.62 + 9.1
    x = px
  }
  return sum
}
const bump = (x: number, z: number, cx: number, cz: number, rx: number, rz: number) =>
  Math.exp(-(((x - cx) / rx) ** 2) - ((z - cz) / rz) ** 2)

const height = new Float32Array(columns * rows)
for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
  const x = (c / (columns - 1) - 0.5) * spanX, z = (r / (rows - 1) - 0.5) * spanZ
  const wx = x + noise(x * 0.16 + 5, z * 0.16) * 2, wz = z + noise(x * 0.16, z * 0.16 + 31) * 2
  const mass = 0.16
    + bump(wx, wz, 5.5, -1.5, 4, 3.6) * 1.05 + bump(wx, wz, 11.5, -2.5, 3.4, 3.2) * 0.72
    + bump(wx, wz, -1.8, -2.6, 3.6, 3.2) * 0.66 + bump(wx, wz, -10, -4, 5, 3) * 0.46
    + bump(wx, wz, 19, -4, 5, 3) * 0.6 + bump(wx, wz, -20, -4.5, 5, 3) * 0.5
  height[r * columns + c] = mass * (1.1 + ridged(wx * 0.17 + 3.7, wz * 0.17 + 8.2) * 4.1) + noise(x * 0.5, z * 0.5) * 0.08
}

const cell = spanX / (columns - 1)
for (let drop = 0; drop < 110000; drop++) {
  let x = 2 + random() * (columns - 6), y = 2 + random() * (rows - 6), dx = 0, dy = 0, speed = 1, water = 1, sediment = 0
  for (let step = 0; step < 36; step++) {
    const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy, i = iy * columns + ix
    const a = height[i], b = height[i + 1], c = height[i + columns], d = height[i + columns + 1]
    dx = dx * 0.08 - ((b - a) * (1 - v) + (d - c) * v) * 0.92
    dy = dy * 0.08 - ((c - a) * (1 - u) + (d - b) * u) * 0.92
    const length = Math.hypot(dx, dy)
    if (length < 1e-7) break
    dx /= length
    dy /= length
    const before = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
    x += dx
    y += dy
    if (x < 2 || y < 2 || x >= columns - 3 || y >= rows - 3) break
    const jx = Math.floor(x), jy = Math.floor(y), s = x - jx, t = y - jy, j = jy * columns + jx
    const after = height[j] * (1 - s) * (1 - t) + height[j + 1] * s * (1 - t) + height[j + columns] * (1 - s) * t + height[j + columns + 1] * s * t
    const delta = after - before
    const capacity = Math.max(-delta, 0.0008) * speed * water * 3.2
    if (sediment > capacity || delta > 0) {
      const amount = delta > 0 ? Math.min(delta, sediment) : (sediment - capacity) * 0.22
      sediment -= amount
      height[i] += amount * (1 - u) * (1 - v)
      height[i + 1] += amount * u * (1 - v)
      height[i + columns] += amount * (1 - u) * v
      height[i + columns + 1] += amount * u * v
    } else {
      const amount = Math.min((capacity - sediment) * 0.2, -delta)
      sediment += amount
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++)
        height[i + oy * columns + ox] -= amount * (ox && oy ? 0.07 : ox || oy ? 0.12 : 0.24)
    }
    speed = Math.sqrt(Math.max(0.05, speed * speed - delta * 6))
    water *= 0.97
  }
}

const sample = (x: number, y: number) => {
  const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy, i = iy * columns + ix
  return (height[i] * (1 - u) + height[i + 1] * u) * (1 - v) + (height[i + columns] * (1 - u) + height[i + columns + 1] * u) * v
}
const horizontal = Math.hypot(sun[0], sun[2])
const stepX = sun[0] / horizontal, stepY = sun[2] / horizontal, rise = sun[1] / horizontal * cell
const light = new Float32Array(columns * rows)
for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
  let lit = 1
  for (let s = 1.5; s < 130; s += 1 + s * 0.025) {
    const x = c + stepX * s, y = r + stepY * s
    if (x < 0 || y < 0 || x >= columns - 1 || y >= rows - 1) break
    lit = Math.min(lit, 1 + (height[r * columns + c] + rise * s - sample(x, y)) / (s * cell) * 9)
    if (lit <= 0) break
  }
  light[r * columns + c] = Math.max(0, lit)
}
postMessage({ height, light }, { transfer: [height.buffer, light.buffer] })
