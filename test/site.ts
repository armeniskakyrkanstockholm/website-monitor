// A web server standing in for the live site, whose pages a test can change while the check is looking.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { Manifest } from '../src/manifest.ts'

export interface Route {
  readonly body: string | Uint8Array
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
}

/** The headers a built site sends, in miniature. */
export const SECURITY: Readonly<Record<string, string>> = { 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff' }

export interface FakeSite {
  readonly origin: string
  /** What each path answers; a test may change it at any time. Any other path answers 404. */
  readonly routes: Map<string, Route>
  /** Every path asked for, in order. */
  readonly requests: string[]
  readonly close: () => Promise<void>
}

export async function serve(pages: Readonly<Record<string, string>>): Promise<FakeSite> {
  const routes = new Map<string, Route>(Object.entries(pages).map(([path, body]) => [path, { body }]))
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? '')
    const route = routes.get(request.url ?? '')
    if (route === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    response.writeHead(route.status ?? 200, { ...SECURITY, ...route.headers }).end(route.body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the stand-in site has no port')
  const origin = `http://127.0.0.1:${address.port}`
  return { origin, routes, requests, close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }) }
}

export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex')

/** What the deploy would say about the pages the site holds now. */
export function manifestOf(site: FakeSite, extra: Partial<Manifest> = {}): Manifest {
  const files = Object.fromEntries([...site.routes].map(([path, route]) => [path, sha256(route.body)]))
  return { source: 'a'.repeat(40), branch: 'staging', origin: site.origin, headers: SECURITY, files, ...extra }
}
