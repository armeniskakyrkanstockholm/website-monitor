import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parseManifest } from '../src/manifest.ts'

const HASH = 'a'.repeat(64)
const valid = { source: 'b'.repeat(40), branch: 'production', origin: 'https://example.se', headers: { 'Content-Security-Policy': "default-src 'none'" }, files: { '/': HASH, '/en/': HASH } }
const parse = (changes: Record<string, unknown>): ReturnType<typeof parseManifest> => parseManifest(JSON.stringify({ ...valid, ...changes }), 'expected/production.json')

describe('reading what the deploy expects', () => {
  it('reads a manifest as the website repository\'s deploy job writes it (a real one, from a staging build)', () => {
    const manifest = parseManifest(readFileSync(join(import.meta.dirname, 'fixtures', 'expected-staging.json'), 'utf8'), 'expected/staging.json')
    assert.equal(manifest.branch, 'staging')
    assert.equal(manifest.origin, 'https://staging.armeniskakyrkansverige.se')
    assert.equal(Object.keys(manifest.files).length, 213)
    assert.equal(manifest.headers['X-Robots-Tag'], 'noindex, nofollow')
    assert.match(manifest.files['/'] ?? '', /^[0-9a-f]{64}$/)
  })

  it('reads a valid one', () => {
    assert.deepEqual(parse({}), valid)
  })

  it('refuses what would make a check pass without looking: no headers, no home page, no files', () => {
    assert.throws(() => parse({ headers: {} }), /must include Content-Security-Policy/)
    assert.throws(() => parse({ files: { '/en/': HASH } }), /must include the home page/)
    assert.throws(() => parse({ files: {} }), /must include the home page/)
  })

  it('refuses a source that is not a commit, an unknown branch, and an origin that is not an https address alone', () => {
    assert.throws(() => parse({ source: 'main' }), /source must be a full commit hash/)
    assert.throws(() => parse({ branch: 'preview' }), /branch must be staging or production/)
    for (const origin of ['http://example.se', 'https://example.se/', 'https://example.se/x', 'example.se', 7]) assert.throws(() => parse({ origin }), /origin must be an https address alone/, String(origin))
  })

  it('refuses a path that is not a path, a hash that is not a SHA-256, and headers or files that are not text', () => {
    assert.throws(() => parse({ files: { '/': HASH, 'en/': HASH } }), /en\/ is not a path/)
    for (const path of ['//evil.example/', '/\\evil.example/', '///evil.example']) assert.throws(() => parse({ files: { '/': HASH, [path]: HASH } }), /is not a path on https:\/\/example\.se/, path)
    assert.throws(() => parse({ files: { '/': 'abc' } }), /\/ has no SHA-256/)
    assert.throws(() => parse({ headers: { 'Content-Security-Policy': 5 } }), /headers must hold text only/)
    assert.throws(() => parse({ files: ['/'] }), /files must be an object/)
  })

  it('names the file in what it says, and refuses text that is not JSON or not an object', () => {
    assert.throws(() => parse({ source: 1 }), /^Error: expected\/production\.json: source/)
    assert.throws(() => parseManifest('[]', 'expected/x.json'), /must be an object/)
    assert.throws(() => parseManifest('not json', 'expected/x.json'), SyntaxError)
  })
})
