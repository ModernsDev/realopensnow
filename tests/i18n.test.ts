import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectLang } from '../src/i18n.ts'

test('a saved choice wins; otherwise the first browser language picks Chinese or English', () => {
  assert.equal(detectLang('en', ['zh-CN']), 'en')
  assert.equal(detectLang('zh', ['en-US']), 'zh')
  assert.equal(detectLang(null, ['zh-TW', 'en']), 'zh')
  assert.equal(detectLang(null, ['en-US', 'zh-CN']), 'en')
  assert.equal(detectLang('bogus', ['fr-FR']), 'en')
})
