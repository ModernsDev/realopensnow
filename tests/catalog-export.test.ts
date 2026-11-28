import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { catalogDocument } from '../scripts/catalog-document.mjs'

test('backend/catalog.json matches the catalog', () => {
  assert.equal(readFileSync(new URL('../backend/catalog.json', import.meta.url), 'utf8'), JSON.stringify(catalogDocument()) + '\n')
})
