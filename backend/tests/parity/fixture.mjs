import { writeFileSync } from 'node:fs'

export function writeFixture(file, data) {
  const columns = [], indices = new Map()
  function pack(value) {
    if (Array.isArray(value)) {
      if (value.length >= 7 && value.every(v => v === null || typeof v === 'number')) {
        const key = JSON.stringify(value)
        if (!indices.has(key)) {
          indices.set(key, columns.length)
          columns.push(value)
        }
        return { $column: indices.get(key) }
      }
      return value.map(pack)
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, pack(v)]))
    }
    return value
  }
  const packed = pack(data)
  writeFileSync(file, JSON.stringify({ ...packed, $columns: columns }) + '\n')
}
