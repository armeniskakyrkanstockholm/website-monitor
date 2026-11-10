// The integrity check: `node src/check.ts`. For each environment in TARGETS (staging, production), it asks the live
// site for every file the last deploy published and compares each with `expected/<branch>.json`. It exits 1 when
// something is wrong, which fails the run, and writes the report the workflow turns into an issue. It uses Node's
// built-ins and git only. It alerts and never repairs: what to do about a difference is Vahagn's to decide (record 0009).
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { certificateProblems } from './certificate.ts'
import { isBranch, type Branch, type Manifest, parseManifest } from './manifest.ts'
import { renderReport, type Result } from './report.ts'
import { verify } from './verify.ts'

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const fileOf = (branch: Branch): string => `expected/${branch}.json`

/** The manifest in this checkout: the one the run began with. */
const readHere = (branch: Branch): Manifest => parseManifest(readFileSync(fileOf(branch), 'utf8'), fileOf(branch))

/** The manifest as the repository holds it now: a deploy may have pushed a newer one since the checkout. */
function readNow(branch: Branch): Manifest {
  git('fetch', '--quiet', 'origin', 'main')
  return parseManifest(git('show', `FETCH_HEAD:${fileOf(branch)}`), fileOf(branch))
}

async function check(branch: Branch, retryDelayMs: number): Promise<Result> {
  let manifest: Manifest
  try {
    manifest = readHere(branch)
  } catch (error) {
    // Listed in TARGETS and not there, or not readable: never a pass, since nothing would then be watched.
    return { branch, source: undefined, files: 0, problems: [`${fileOf(branch)} cannot be used: ${messageOf(error)}`] }
  }
  const files = Object.keys(manifest.files).length
  try {
    const problems = await verify(manifest, { concurrency: 6, certificateProblems }, { retryDelayMs, readAgain: async () => readNow(branch) })
    return { branch, source: manifest.source, files, problems }
  } catch (error) {
    // Reading the manifest again can fail (no network to GitHub, say). The run still fails and still writes its report, so the issue step has one.
    return { branch, source: manifest.source, files, problems: [`the check could not finish: ${messageOf(error)}`] }
  }
}

if (import.meta.main) {
  const branches = (process.env['TARGETS'] ?? '').split(',').map((name) => name.trim()).filter((name) => name !== '')
  if (branches.length === 0 || !branches.every(isBranch)) throw new Error(`TARGETS names the environments to watch, from staging and production, such as staging,production; it is "${process.env['TARGETS'] ?? ''}"`)
  const retryDelayMs = Number(process.env['RETRY_DELAY_SECONDS'] ?? '120') * 1000
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new Error('RETRY_DELAY_SECONDS is a number of seconds')
  const results: Result[] = []
  for (const branch of branches) results.push(await check(branch, retryDelayMs))
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: run, GITHUB_STEP_SUMMARY: summary, REPORT_FILE: reportFile = 'report.md' } = process.env
  const report = renderReport(results, new Date(), server !== undefined && repository !== undefined && run !== undefined ? `${server}/${repository}/actions/runs/${run}` : undefined)
  writeFileSync(reportFile, report)
  if (summary !== undefined) appendFileSync(summary, report)
  for (const { branch, problems } of results) for (const problem of problems) console.error(`${branch}: ${problem}`)
  console.log(report)
  if (results.some((result) => result.problems.length > 0)) process.exitCode = 1
}
