// Asking the live site about everything the deploy said it holds, and trying again before calling a difference real.
import { HIDDEN_PATHS, problemsWith, problemWithHidden } from './compare.ts'
import type { Manifest } from './manifest.ts'
import { fetchAt, inParallel, isFailure } from './sweep.ts'

/** What the check asks with, so a test can put a stand-in where the network would be. */
export interface Probes {
  /** How many requests are open at once: the site is on shared hosting, so few. */
  readonly concurrency: number
  /** What is wrong with the certificate `host` presents. */
  readonly certificateProblems: (host: string) => Promise<string[]>
}

/** Every difference between the live site and `manifest`: the certificate, each file's contents and headers, and the paths that must be refused. */
export async function inspect(manifest: Manifest, { concurrency, certificateProblems }: Probes): Promise<string[]> {
  const addressOf = (path: string): URL => new URL(path, manifest.origin)
  const certificate = await certificateProblems(addressOf('/').hostname)
  const files = await inParallel(Object.entries(manifest.files), concurrency, async ([path, sha256]) => {
    const answer = await fetchAt(addressOf(path))
    return isFailure(answer) ? [answer.failed] : problemsWith(path, { sha256, headers: manifest.headers }, answer)
  })
  const hidden = await inParallel(HIDDEN_PATHS, concurrency, async (path) => {
    const answer = await fetchAt(addressOf(path))
    if (isFailure(answer)) return [answer.failed]
    const problem = problemWithHidden(path, answer.status)
    return problem === undefined ? [] : [problem]
  })
  return [...certificate, ...files.flat(), ...hidden.flat()]
}

export interface Retry {
  readonly retryDelayMs: number
  /** The manifest as it is now, since a deploy may have landed while the first look was under way. */
  readonly readAgain: () => Promise<Manifest>
}

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * What is wrong with the live site, after a second look. A deploy publishes the site and then tells the monitor, and
 * the server takes a moment to pull it, so a difference seen once may be a deploy in flight. It counts only if it is
 * still there after `retryDelayMs`, against the manifest read again. Nothing wrong gives an empty list.
 */
export async function verify(manifest: Manifest, probes: Probes, { retryDelayMs, readAgain }: Retry): Promise<string[]> {
  const first = await inspect(manifest, probes)
  if (first.length === 0) return []
  await wait(retryDelayMs)
  return inspect(await readAgain(), probes)
}
