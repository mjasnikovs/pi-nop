import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {check, failures} from './check'
import type {Case} from './check'
import {port, serveFixtures} from './fixtures'
import {runPi, text} from './pi'

const server = serveFixtures()
const base = `http://127.0.0.1:${server.port}`
const toolUrl = `${base}/tool`
const missingUrl = `${base}/nope`
const transcripts = join(import.meta.dir, 'transcripts')

const cases: Case[] = [
    {
        name: 'fact-on-page',
        prompt: `Use subagent-fetch on ${toolUrl}. What is the default port? Reply with the number only.`,
        checks: run => [
            check(
                'tool called with url',
                run.calls.some(call => call.arguments.url === toolUrl)
            ),
            check('tool did not error', !run.results.some(result => result.isError)),
            check(`answer holds port, got: ${run.answer}`, run.answer.includes(port))
        ]
    },
    {
        name: 'missing-page',
        prompt: `Use subagent-fetch on ${missingUrl} and tell me what it says.`,
        checks: run => [
            check(
                'tool errored with 404',
                run.results.some(result => result.isError && text(result.content).includes('404'))
            ),
            check(`answer reports 404, got: ${run.answer}`, run.answer.includes('404'))
        ]
    }
]

const runCase = async (testCase: Case): Promise<string[]> => {
    const run = await runPi(testCase.prompt, 'subagent-fetch')
    writeFileSync(join(transcripts, `${testCase.name}.jsonl`), run.events)
    // The random port may itself contain a digit string a check looks for.
    return failures(testCase.checks({...run, answer: run.answer.replaceAll(base, '')}))
}

const report = (name: string, problems: string[]): void => {
    console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'} ${name}`)
    for (const problem of problems) console.log(`  ${problem}`)
}
mkdirSync(transcripts, {recursive: true})

let failed = 0

for (const testCase of cases) {
    const problems = await runCase(testCase)
    report(testCase.name, problems)
    if (problems.length > 0) failed++
}

await server.stop()
process.exit(failed === 0 ? 0 : 1)
