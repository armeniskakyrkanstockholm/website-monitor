// The words of an alert: what the issue says, and what the run's summary shows.
import type { Branch } from './manifest.ts'

/** What the check found for one environment. */
export interface Result {
  readonly branch: Branch
  /** The expected build's commit, or undefined when there was no manifest to read. */
  readonly source: string | undefined
  readonly files: number
  readonly problems: readonly string[]
}

/** More lines than this say little more than the first ones, and make an issue hard to read. */
const MOST_LINES = 25

/** Longer than this is cut: a header value from a live site has no limit, and the issue would be unreadable. */
const MOST_CHARACTERS = 300

/**
 * `text` as inline code, so that what the live site sent, a header's value above all, cannot become a link, an image
 * or an @mention in a public issue if the site has been taken over. A backtick or a line break in it becomes a space.
 */
const asCode = (text: string): string => `\`${text.replace(/[`\r\n]+/g, ' ').slice(0, MOST_CHARACTERS)}\``

/** A problem about one path, `/en/ lacks the header X`: the path, and what is wrong with it. */
const ABOUT_A_PATH = /^(\/\S*) (.+)$/

/**
 * One line for each different thing that is wrong. A fault that touches every file, such as a header that has gone,
 * would otherwise fill the report with 200 lines that differ in their first word, and hide the rest.
 */
function grouped(problems: readonly string[]): string[] {
  const pathsByFault = new Map<string, string[]>()
  const lines: string[] = []
  for (const problem of problems) {
    const [, path, fault] = ABOUT_A_PATH.exec(problem) ?? []
    if (path === undefined || fault === undefined) lines.push(problem)
    else pathsByFault.set(fault, [...(pathsByFault.get(fault) ?? []), path])
  }
  const faults = [...pathsByFault].map(([fault, paths]) => (paths.length === 1 ? `${paths[0]} ${fault}` : `${paths.length} files (${paths.slice(0, 3).join(', ')}, …): ${fault}`))
  return [...lines, ...faults]
}

/** The report as Markdown, for the run's summary and, when something is wrong, the issue. `runUrl` links to the run that found it. */
export function renderReport(results: readonly Result[], now: Date, runUrl: string | undefined): string {
  const wrong = results.filter((result) => result.problems.length > 0)
  const heading = wrong.length === 0 ? '# The live site is as it was deployed' : '# The live site differs from what was deployed'
  const when = `Checked ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC${runUrl === undefined ? '' : ` in [this run](${runUrl})`}.`
  const sections = results.map(({ branch, source, files, problems }) => {
    const build = source === undefined ? 'no expected build' : `expected build ${source.slice(0, 7)}`
    if (problems.length === 0) return `## ${branch}: all ${files} files match (${build})`
    const lines = grouped(problems)
    const shown = lines.slice(0, MOST_LINES).map((line) => `- ${asCode(line)}`)
    const hidden = lines.length - shown.length
    return [`## ${branch}: ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} (${build})`, ...shown, ...(hidden > 0 ? [`- … and ${hidden} more in the run's log`] : [])].join('\n')
  })
  return `${[heading, when, ...sections].join('\n\n')}\n`
}
