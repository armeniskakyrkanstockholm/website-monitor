// What the deploy job says the live site must be: `expected/<branch>.json`, written by the website repository's deploy
// job from the build it has just published (src/deploy/monitor.ts there). The yardstick is never read from the live
// site, so whoever changed the site could not change it too. The file is read strictly: a manifest that expects
// nothing would let every check pass.

export const BRANCHES = ['staging', 'production'] as const
export type Branch = (typeof BRANCHES)[number]
export const isBranch = (value: string): value is Branch => (BRANCHES as readonly string[]).includes(value)

export interface Manifest {
  /** The commit of the website repository the build was made from. */
  readonly source: string
  readonly branch: Branch
  /** The site's address with no trailing slash: `https://armeniskakyrkansverige.se`. */
  readonly origin: string
  /** The headers every response carries, by name. */
  readonly headers: Readonly<Record<string, string>>
  /** The path of each served address (`/`, `/en/`) → the SHA-256 of its bytes, in hex. */
  readonly files: Readonly<Record<string, string>>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const SOURCE_COMMIT = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/

function stringsOf(value: unknown, what: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`${what} must be an object`)
  const entries = Object.entries(value)
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) throw new Error(`${what} must hold text only`)
  return Object.fromEntries(entries)
}

/** The manifest in `text`, or an error that says what is wrong with it. `name` is only for the message. */
export function parseManifest(text: string, name: string): Manifest {
  const fail = (reason: string): never => {
    throw new Error(`${name}: ${reason}`)
  }
  const json: unknown = JSON.parse(text)
  if (!isRecord(json)) return fail('must be an object')
  const { source, branch, origin } = json
  if (typeof source !== 'string' || !SOURCE_COMMIT.test(source)) return fail('source must be a full commit hash')
  if (typeof branch !== 'string' || !isBranch(branch)) return fail(`branch must be ${BRANCHES.join(' or ')}`)
  if (typeof origin !== 'string' || !URL.canParse(origin) || new URL(origin).origin !== origin || !origin.startsWith('https://')) return fail('origin must be an https address alone, such as https://example.se')
  const headers = stringsOf(json['headers'], `${name}: headers`)
  if (!('Content-Security-Policy' in headers)) return fail('headers must include Content-Security-Policy, or nothing would be checked')
  const files = stringsOf(json['files'], `${name}: files`)
  if (!('/' in files)) return fail('files must include the home page, "/"')
  for (const [path, hash] of Object.entries(files)) {
    // `//host/` and `/\\host/` start with a slash and still make `new URL(path, origin)` ask another host.
    if (!path.startsWith('/') || new URL(path, origin).origin !== origin) return fail(`${path} is not a path on ${origin}`)
    if (!SHA256.test(hash)) return fail(`${path} has no SHA-256`)
  }
  return { source, branch, origin, headers, files }
}
