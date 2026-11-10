import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, it } from 'node:test'
import { HIDDEN_PATHS } from '../src/compare.ts'
import type { Manifest } from '../src/manifest.ts'
import { inspect, verify, type Probes } from '../src/verify.ts'
import { manifestOf, serve, sha256, type FakeSite } from './site.ts'

const PAGES = { '/': '<h1>Hem</h1>', '/en/': '<h1>Home</h1>', '/styles/site.3f2a1c9d.css': 'body{}', '/%D5%A1/': 'armenian' }
const probes: Probes = { concurrency: 3, certificateProblems: async () => [] }

const open: FakeSite[] = []
afterEach(async () => {
  for (const site of open.splice(0)) await site.close()
})
async function site(pages: Readonly<Record<string, string>> = PAGES): Promise<FakeSite> {
  const started = await serve(pages)
  open.push(started)
  return started
}

describe('looking at the live site', () => {
  it('finds nothing wrong when every file and header is as the deploy said, and asks for each path once', async () => {
    const live = await site()
    assert.deepEqual(await inspect(manifestOf(live), probes), [])
    assert.deepEqual([...live.requests].sort(), [...Object.keys(PAGES), ...HIDDEN_PATHS].sort())
  })

  it('finds a file whose contents differ by one byte', async () => {
    const live = await site()
    const manifest = manifestOf(live)
    live.routes.set('/en/', { body: '<h1>Home!</h1>' })
    assert.deepEqual(await inspect(manifest, probes), [`/en/ has other contents: SHA-256 ${sha256('<h1>Home!</h1>').slice(0, 12)}…, expected ${sha256(PAGES['/en/']).slice(0, 12)}…`])
  })

  it('finds a security header that has gone, and one that has changed', async () => {
    const live = await site()
    const manifest = manifestOf(live)
    live.routes.set('/', { body: PAGES['/'], headers: { 'Content-Security-Policy': "default-src *" } })
    live.routes.set('/en/', { body: PAGES['/en/'], headers: { 'X-Content-Type-Options': '' } })
    const problems = await inspect(manifest, probes)
    assert.ok(problems.includes("/ sends Content-Security-Policy: default-src *, expected default-src 'none'"), problems.join('\n'))
    assert.ok(problems.some((problem) => problem.startsWith('/en/ sends X-Content-Type-Options: , expected nosniff')), problems.join('\n'))
  })

  it('finds noindex put on a site that is not staging, and the server naming its software', async () => {
    const live = await site()
    const manifest = manifestOf(live, { branch: 'production' })
    live.routes.set('/', { body: PAGES['/'], headers: { 'X-Robots-Tag': 'noindex', 'X-Powered-By': 'PHP/8.2' } })
    assert.deepEqual(await inspect(manifest, probes), ['/ sends x-powered-by, which the server is set not to', '/ sends X-Robots-Tag: noindex, which this build never sets'])
  })

  it('finds a file that now redirects, and one that is gone', async () => {
    const live = await site()
    const manifest = manifestOf(live)
    live.routes.set('/en/', { body: '', status: 301, headers: { Location: 'https://elsewhere.example/' } })
    live.routes.delete('/styles/site.3f2a1c9d.css')
    assert.deepEqual(await inspect(manifest, probes), ['/en/ answers 301, not 200', '/styles/site.3f2a1c9d.css answers 404, not 200'])
  })

  it('finds a hidden path that is served, and accepts one that is refused', async () => {
    const live = await site()
    const manifest = manifestOf(live)
    live.routes.set('/.git/config', { body: '[core]' })
    live.routes.set('/.release.json', { body: 'refused', status: 403 })
    assert.deepEqual(await inspect(manifest, probes), ['/.git/config answers 200, and must be refused with 403 or 404'])
  })

  it('hashes what a browser gets, so a file the server compresses is not a difference', async () => {
    const live = await site()
    const manifest = manifestOf(live)
    live.routes.set('/', { body: gzipSync(PAGES['/']), headers: { 'Content-Encoding': 'gzip' } })
    assert.deepEqual(await inspect(manifest, probes), [])
  })

  it('names every path it could not reach, when the site is down', async () => {
    const live = await site()
    const manifest = manifestOf(live)
    await live.close()
    open.length = 0
    const problems = await inspect(manifest, probes)
    assert.equal(problems.length, Object.keys(PAGES).length + 5, 'each file and each hidden path')
    assert.ok(problems.every((problem) => problem.includes('could not be fetched')), problems.join('\n'))
  })

  it('adds what is wrong with the certificate', async () => {
    const live = await site()
    const problems = await inspect(manifestOf(live), { ...probes, certificateProblems: async (host) => [`the certificate of ${host} ends in 3 days`] })
    assert.deepEqual(problems, ['the certificate of 127.0.0.1 ends in 3 days'])
  })

  it('asks for a percent-encoded path as it is written, not encoded twice', async () => {
    const live = await site()
    assert.deepEqual(await inspect(manifestOf(live), probes), [])
    assert.ok(live.routes.has('/%D5%A1/'))
  })
})

describe('a second look before calling it a difference', () => {
  const noWait = { retryDelayMs: 0 }

  it('does not look again, nor read the manifest again, when the first look finds nothing', async () => {
    const live = await site()
    let reads = 0
    const problems = await verify(manifestOf(live), probes, { ...noWait, readAgain: async () => { reads += 1; return manifestOf(live) } })
    assert.deepEqual(problems, [])
    assert.equal(reads, 0)
  })

  it('lets a deploy that lands during the wait pass: the server finishes pulling and the second look is clean', async () => {
    const live = await site()
    const deployed = manifestOf(live)
    live.routes.set('/', { body: 'the old home page, before the server pulled' })
    const problems = await verify(deployed, probes, {
      ...noWait,
      readAgain: async () => {
        live.routes.set('/', { body: PAGES['/'] })
        return deployed
      },
    })
    assert.deepEqual(problems, [])
  })

  it('lets a newer deploy pass: the manifest read again is the newer one, which the site already has', async () => {
    const live = await site()
    const older: Manifest = manifestOf(live)
    live.routes.set('/', { body: 'the next deploy' })
    const problems = await verify(older, probes, { ...noWait, readAgain: async () => manifestOf(live, { source: 'c'.repeat(40) }) })
    assert.deepEqual(problems, [])
  })

  it('reports a difference that is still there at the second look, from the second look only', async () => {
    const live = await site()
    const manifest = manifestOf(live)
    live.routes.set('/', { body: 'defaced' })
    live.routes.set('/en/', { body: 'defaced too' })
    const problems = await verify(manifest, probes, {
      ...noWait,
      readAgain: async () => {
        live.routes.set('/en/', { body: PAGES['/en/'] })
        return manifest
      },
    })
    assert.equal(problems.length, 1, 'the page that healed is not reported')
    assert.match(problems[0] ?? '', /^\/ has other contents/)
  })

  it('waits as long as it is told before it looks again', async () => {
    const live = await site()
    const manifest = manifestOf(live)
    live.routes.set('/', { body: 'defaced' })
    const started = Date.now()
    await verify(manifest, probes, { retryDelayMs: 300, readAgain: async () => manifest })
    assert.ok(Date.now() - started >= 280)
  })
})

