import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderReport } from '../src/report.ts'

const NOW = new Date('2026-11-10T07:52:31Z')
const RUN = 'https://github.com/o/website-monitor/actions/runs/1'

describe('the report', () => {
  it('says all is well, with the build it expected and how many files matched', () => {
    const report = renderReport([{ branch: 'staging', source: 'abcdef1234567', files: 213, problems: [] }], NOW, RUN)
    assert.equal(report, '# The live site is as it was deployed\n\nChecked 2026-11-10 07:52 UTC in [this run](https://github.com/o/website-monitor/actions/runs/1).\n\n## staging: all 213 files match (expected build abcdef1)\n')
  })

  it('lists the problems of each environment that has any, and the clean ones in a line', () => {
    const report = renderReport([{ branch: 'staging', source: 'abcdef1234567', files: 213, problems: [] }, { branch: 'production', source: 'fedcba7654321', files: 213, problems: ['/ has other contents', '/en/ answers 301, not 200'] }], NOW, undefined)
    assert.match(report, /^# The live site differs from what was deployed\n\nChecked 2026-11-10 07:52 UTC\.\n/)
    assert.match(report, /## staging: all 213 files match/)
    assert.match(report, /## production: 2 problems \(expected build fedcba7\)\n- `\/ has other contents`\n- `\/en\/ answers 301, not 200`\n$/)
  })

  it('cuts a long list short and says how many more are in the log, so one outage is not 200 lines', () => {
    const problems = Array.from({ length: 40 }, (_, index) => `/page-${index} has other contents: SHA-256 ${String(index).padStart(12, '0')}…`)
    const report = renderReport([{ branch: 'production', source: 'fedcba7654321', files: 213, problems }], NOW, undefined)
    assert.equal(report.split('\n').filter((line) => line.startsWith('- `/page-')).length, 25)
    assert.match(report, /- … and 15 more in the run's log/)
  })

  it('puts one line on a fault that touches many files, so it does not hide the others', () => {
    const everywhere = ['/', '/en/', '/hy/', '/sv/'].map((path) => `${path} lacks the header Strict-Transport-Security`)
    const report = renderReport([{ branch: 'production', source: 'fedcba7654321', files: 213, problems: [...everywhere, '/en/ has other contents: SHA-256 abc…, expected def…', 'the certificate of example.se ends in 3 days'] }], NOW, undefined)
    assert.match(report, /- `the certificate of example\.se ends in 3 days`\n/)
    assert.match(report, /- `4 files \(\/, \/en\/, \/hy\/, …\): lacks the header Strict-Transport-Security`\n/)
    assert.match(report, /- `\/en\/ has other contents: SHA-256 abc…, expected def…`\n/)
    assert.match(report, /## production: 6 problems/, 'the heading still counts every problem')
  })

  it('puts what the live site sent in code, so a taken-over site cannot put a link or an @mention into the issue, and cuts a long value', () => {
    const hostile = '/ sends X-Test: [click](https://evil.example) ![x](https://evil.example/a.png) @someone `end`\n# heading ' + 'x'.repeat(400)
    const report = renderReport([{ branch: 'production', source: 'fedcba7654321', files: 213, problems: [hostile] }], NOW, undefined)
    const line = report.split('\n').find((candidate) => candidate.startsWith('- `')) ?? ''
    assert.ok(line.startsWith('- `/ sends X-Test: [click](https://evil.example)') && line.endsWith('`'), line)
    assert.equal(line.slice(3, -1).includes('`'), false, 'no backtick can close the code early')
    assert.ok(line.length <= 3 + 300 + 1, 'cut')
    assert.equal(report.split('\n').filter((candidate) => candidate.startsWith('#')).length, 2, 'a # in the value does not make a heading: only the report\'s own two')
  })

  it('says when there was no manifest to expect anything of', () => {
    assert.match(renderReport([{ branch: 'production', source: undefined, files: 0, problems: ['expected/production.json cannot be used: ENOENT'] }], NOW, undefined), /## production: 1 problem \(no expected build\)/)
  })
})
