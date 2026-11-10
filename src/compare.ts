// What one answer from the live site must look like, set against what the deploy said. Pure: no network, so the tests
// can put each fault in by hand.

/** What the deploy expects of one file. */
export interface Expectation {
  readonly sha256: string
  readonly headers: Readonly<Record<string, string>>
}

/** What the live site answered. */
export interface Observed {
  readonly status: number
  readonly headers: Headers
  /** The SHA-256 of the body as a visitor's browser gets it, once the server's compression is undone. */
  readonly sha256: string
}

/** Sent by nothing we run, and a sign of the wrong software answering. */
const NEVER_SENT = ['x-powered-by'] as const

const shortened = (hash: string): string => `${hash.slice(0, 12)}…`

/** Every way `observed` differs from `expected` for `path`, each a line a person can read; none when all is as it should be. */
export function problemsWith(path: string, expected: Expectation, observed: Observed): string[] {
  if (observed.status !== 200) return [`${path} answers ${observed.status}, not 200`]
  const problems: string[] = []
  if (observed.sha256 !== expected.sha256) problems.push(`${path} has other contents: SHA-256 ${shortened(observed.sha256)}, expected ${shortened(expected.sha256)}`)
  for (const [name, value] of Object.entries(expected.headers)) {
    const seen = observed.headers.get(name)
    if (seen === null) problems.push(`${path} lacks the header ${name}`)
    else if (seen !== value) problems.push(`${path} sends ${name}: ${seen}, expected ${value}`)
  }
  for (const name of NEVER_SENT) if (observed.headers.has(name)) problems.push(`${path} sends ${name}, which the server is set not to`)
  // A live site that says noindex disappears from search without anything looking broken.
  const expectedNames = new Set(Object.keys(expected.headers).map((name) => name.toLowerCase()))
  if (!expectedNames.has('x-robots-tag') && observed.headers.has('x-robots-tag')) problems.push(`${path} sends X-Robots-Tag: ${observed.headers.get('x-robots-tag')}, which this build never sets`)
  return problems
}

/** Paths that must never be served: the pull's `.git`, the deploy's own file, and the server's rules. */
export const HIDDEN_PATHS = ['/.git/config', '/.git/HEAD', '/.release.json', '/.htaccess', '/.env'] as const

/** What the server may answer for a hidden path: refused or not found, never a file or a redirect. */
const REFUSED = [403, 404, 410]

/** What is wrong with the answer for a hidden path, or undefined when it is refused as it should be. */
export const problemWithHidden = (path: string, status: number): string | undefined => (REFUSED.includes(status) ? undefined : `${path} answers ${status}, and must be refused with 403 or 404`)
