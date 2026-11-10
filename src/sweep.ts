// Asking the live site, politely: a few requests at a time, with a name that says who is asking.
import { createHash } from 'node:crypto'
import type { Observed } from './compare.ts'

const USER_AGENT = 'website-monitor (+https://github.com/armeniskakyrkanstockholm/website-monitor)'
const TIMEOUT_MS = 20_000

/** Why the site could not be asked. */
export interface Failure {
  readonly failed: string
}

export const isFailure = (answer: Observed | Failure): answer is Failure => 'failed' in answer

/**
 * One GET of `url`, not following a redirect (a file that redirects is a finding), with the body hashed as the browser
 * gets it. A refused connection, a timeout or a broken answer is a `Failure`, never an exception.
 */
export async function fetchAt(url: URL): Promise<Observed | Failure> {
  try {
    const response = await fetch(url, { redirect: 'manual', headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const sha256 = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')
    return { status: response.status, headers: response.headers, sha256 }
  } catch (error) {
    return { failed: `${url.pathname} could not be fetched: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** `work` over every item, `limit` at a time, results in the items' order. */
export async function inParallel<Item, Result>(items: readonly Item[], limit: number, work: (item: Item) => Promise<Result>): Promise<Result[]> {
  const results: Result[] = []
  const queue = [...items.entries()]
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const [index, item] = next
      results[index] = await work(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
