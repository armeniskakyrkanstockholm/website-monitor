import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { problemsWith, problemWithHidden, type Observed } from '../src/compare.ts'

const HASH = 'a'.repeat(64)
const expected = { sha256: HASH, headers: { 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff' } }
const observe = (headers: Record<string, string>, overrides: Partial<Observed> = {}): Observed => ({ status: 200, sha256: HASH, headers: new Headers(headers), ...overrides })
const GOOD = { 'content-security-policy': "default-src 'none'", 'x-content-type-options': 'nosniff' }

describe('one answer set against what the deploy said', () => {
  it('has no problem when the contents and every header are as expected, whatever the case of the names', () => {
    assert.deepEqual(problemsWith('/', expected, observe(GOOD)), [])
  })

  it('says a file has other contents, with both hashes cut short, when a byte differs', () => {
    assert.deepEqual(problemsWith('/en/', expected, observe(GOOD, { sha256: 'b'.repeat(64) })), ['/en/ has other contents: SHA-256 bbbbbbbbbbbb…, expected aaaaaaaaaaaa…'])
  })

  it('says a header is missing, and says one is different', () => {
    assert.deepEqual(problemsWith('/', expected, observe({ 'x-content-type-options': 'nosniff' })), ['/ lacks the header Content-Security-Policy'])
    assert.deepEqual(problemsWith('/', expected, observe({ ...GOOD, 'content-security-policy': "default-src *" })), ["/ sends Content-Security-Policy: default-src *, expected default-src 'none'"])
  })

  it('says so when a status other than 200 answers, and reports nothing more about that answer', () => {
    assert.deepEqual(problemsWith('/', expected, observe({}, { status: 301, sha256: 'c'.repeat(64) })), ['/ answers 301, not 200'])
  })

  it('says so when the server names its software', () => {
    assert.deepEqual(problemsWith('/', expected, observe({ ...GOOD, 'x-powered-by': 'PHP/8.2' })), ['/ sends x-powered-by, which the server is set not to'])
  })

  it('says so when noindex appears where the build never sets it, and not where it does', () => {
    assert.deepEqual(problemsWith('/', expected, observe({ ...GOOD, 'x-robots-tag': 'noindex, nofollow' })), ['/ sends X-Robots-Tag: noindex, nofollow, which this build never sets'])
    const staging = { ...expected, headers: { ...expected.headers, 'X-Robots-Tag': 'noindex, nofollow' } }
    assert.deepEqual(problemsWith('/', staging, observe({ ...GOOD, 'x-robots-tag': 'noindex, nofollow' })), [])
    assert.deepEqual(problemsWith('/', staging, observe(GOOD)), ['/ lacks the header X-Robots-Tag'])
  })
})

describe('a path that must not be served', () => {
  it('is fine when refused or not found, and a problem when anything else answers', () => {
    for (const status of [403, 404, 410]) assert.equal(problemWithHidden('/.git/config', status), undefined, String(status))
    for (const status of [200, 301, 304, 500]) assert.match(problemWithHidden('/.git/config', status) ?? '', /^\/\.git\/config answers \d+, and must be refused/, String(status))
  })
})
