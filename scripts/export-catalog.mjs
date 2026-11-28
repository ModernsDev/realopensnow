import { writeFileSync } from 'node:fs'
import { catalogDocument } from './catalog-document.mjs'

writeFileSync(new URL('../backend/catalog.json', import.meta.url), JSON.stringify(catalogDocument()) + '\n')
