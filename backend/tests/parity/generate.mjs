import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generateAccuracy } from './accuracy.mjs'
import { generatePages } from './page.mjs'
import { generateRefresh } from './refresh.mjs'

mkdirSync(new URL('../fixtures/expected/', import.meta.url), { recursive: true })
const env = { ...process.env, UPDATE_TZ_DIFFERENCES: '1' }
const cache = fileURLToPath(new URL('../../../.cargo-home/', import.meta.url))
if (!env.CARGO_HOME && existsSync(cache)) env.CARGO_HOME = cache
execFileSync('cargo', ['test', '--offline', '--test', 'timezone', 'calendar_parity', '--', '--exact'], {
  cwd: new URL('../../', import.meta.url), env, stdio: 'inherit',
})
await generatePages()
await generateRefresh()
await generateAccuracy()
