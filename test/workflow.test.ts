import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const workflow = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'integrity.yml'), 'utf8')

describe('the integrity workflow', () => {
  it('pins every action to a full commit SHA', () => {
    const used = [...workflow.matchAll(/^\s*- uses:\s*(\S+)/gm)].map((match) => match[1] ?? '')
    assert.ok(used.length >= 2)
    for (const action of used) assert.match(action, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, action)
  })

  it('has a read-only token at the top, writes issues in its one job only, and has no trigger that runs outside code with a token', () => {
    assert.match(workflow, /^permissions:\n {2}contents: read$/m)
    assert.equal(workflow.match(/issues: write/g)?.length, 1)
    assert.doesNotMatch(workflow, /pull_request/)
    assert.doesNotMatch(workflow, /secrets\./, 'this repository holds no secret')
    assert.match(workflow, /persist-credentials: false/)
  })

  it('installs nothing, so no package runs beside the token that writes issues', () => {
    assert.doesNotMatch(workflow, /\b(?:npm|npx|yarn|pnpm)\b/)
  })

  it('runs every 15 minutes off the top of the hour, and when a deploy writes a manifest, and by hand', () => {
    assert.match(workflow, /cron: '7,22,37,52 \* \* \* \*'/)
    assert.match(workflow, /push:\n\s+branches: \[main\]\n\s+paths: \['expected\/\*\*'\]/)
    assert.match(workflow, /workflow_dispatch:/)
  })

  it('never has two runs at once, and opens an issue only when its own check failed', () => {
    assert.match(workflow, /concurrency:\n {2}group: integrity\n {2}cancel-in-progress: false/)
    assert.match(workflow, /if: failure\(\) && steps\.check\.outcome == 'failure'/)
  })

  it('watches staging, and says where production is added', () => {
    assert.match(workflow, /^ {6}TARGETS: staging$/m)
  })
})
