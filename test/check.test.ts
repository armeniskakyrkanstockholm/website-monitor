import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const CHECK = join(import.meta.dirname, '..', 'src', 'check.ts')
const folders: string[] = []
after(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
})

/** Runs the check as the workflow does, in a checkout of its own, with the given environment and expected files. */
function run(environment: Record<string, string>, expected: Readonly<Record<string, string>> = {}): { readonly status: number | null; readonly output: string; readonly report: string | undefined } {
  const cwd = mkdtempSync(join(tmpdir(), 'aks-check-'))
  folders.push(cwd)
  mkdirSync(join(cwd, 'expected'))
  for (const [name, text] of Object.entries(expected)) writeFileSync(join(cwd, 'expected', name), text)
  const { GITHUB_STEP_SUMMARY: _summary, GITHUB_RUN_ID: _run, ...inherited } = process.env
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CHECK], { cwd, encoding: 'utf8', env: { ...inherited, RETRY_DELAY_SECONDS: '0', ...environment } })
  const report = (() => {
    try {
      return readFileSync(join(cwd, 'report.md'), 'utf8')
    } catch {
      return undefined
    }
  })()
  return { status: result.status, output: `${result.stdout}${result.stderr}`, report }
}

describe('the check, run as the workflow runs it', () => {
  it('stops with a message when TARGETS is missing or names an environment that does not exist, and watches nothing', () => {
    for (const TARGETS of ['', 'preview', 'staging,preview']) {
      const { status, output, report } = run({ TARGETS })
      assert.equal(status, 1, TARGETS)
      assert.match(output, /TARGETS names the environments to watch/, TARGETS)
      assert.equal(report, undefined)
    }
  })

  it('fails the run, and says so in the report, when a listed environment has no manifest: nothing deployed there, or the file was removed', () => {
    const { status, output, report } = run({ TARGETS: 'staging' })
    assert.equal(status, 1)
    assert.match(output, /staging: expected\/staging\.json cannot be used: ENOENT/)
    assert.match(report ?? '', /^# The live site differs from what was deployed/)
    assert.match(report ?? '', /## staging: 1 problem \(no expected build\)/)
  })

  it('fails the run when a manifest is there and cannot be used, and goes on to the next environment', () => {
    const { status, report } = run({ TARGETS: 'staging,production' }, { 'staging.json': '{"source": "nope"}' })
    assert.equal(status, 1)
    assert.match(report ?? '', /## staging: 1 problem/)
    assert.match(report ?? '', /## production: 1 problem/)
    assert.match(report ?? '', /source must be a full commit hash/)
  })

  it('fails the run and still writes the report when it cannot finish, such as when the manifest cannot be read again', () => {
    const manifest = JSON.stringify({ source: 'a'.repeat(40), branch: 'staging', origin: 'https://127.0.0.1:1', headers: { 'Content-Security-Policy': "default-src 'none'" }, files: { '/': 'b'.repeat(64) } })
    const { status, output, report } = run({ TARGETS: 'staging' }, { 'staging.json': manifest })
    assert.equal(status, 1)
    assert.match(output, /staging: the check could not finish: /)
    assert.match(report ?? '', /## staging: \d+ problems? \(expected build aaaaaaa\)/)
  })

  it('refuses a retry delay that is not a number of seconds', () => {
    const { status, output } = run({ TARGETS: 'staging', RETRY_DELAY_SECONDS: 'soon' })
    assert.equal(status, 1)
    assert.match(output, /RETRY_DELAY_SECONDS is a number of seconds/)
  })
})
