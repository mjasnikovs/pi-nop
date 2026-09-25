import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {parseAnswer} from '../src/subagent/answer'
import type {Answer, Coverage} from '../src/subagent/answer'
import {text} from './pi'
import type {Run} from './pi'

type Check = {
    name: string
    ok: boolean
}

type Case = {
    name: string
    prompt: string
    checks: (run: Run) => Check[]
}

const check = (name: string, ok: boolean): Check => ({name, ok})

const failures = (checks: Check[]): string[] =>
    checks.filter(item => !item.ok).map(item => item.name)

const errored = (run: Run): boolean => run.results.some(result => result.isError)
const texts = (run: Run, errors: boolean): string =>
    run.results
        .filter(result => result.isError === errors)
        .map(result => text(result.content))
        .join('\n')
const errorText = (run: Run): string => texts(run, true)
const resultText = (run: Run): string => texts(run, false)

const firstResult = (run: Run): string => {
    const result = run.results.find(item => !item.isError)
    return result === undefined ? '' : text(result.content)
}

// The first tool result may lead with a header; the model's layout starts at its COVERED line.
const split = (run: Run): {header: string; layout: string} => {
    const lines = firstResult(run).split('\n')
    const at = lines.findIndex(line => line.trim().startsWith('COVERED:'))

    if (at === -1) return {header: lines.join('\n'), layout: ''}
    return {header: lines.slice(0, at).join('\n'), layout: lines.slice(at).join('\n')}
}

// The tool already rejected any layout it could not parse, so a result parses or errored.
const shaped = (run: Run): Answer | undefined => parseAnswer(split(run).layout)

type Needle = string | RegExp
const matches = (haystack: string, needle: Needle): boolean =>
    typeof needle === 'string' ? haystack.includes(needle) : needle.test(haystack)
const holds = (label: string, haystack: string | undefined, needle: Needle) =>
    check(
        `${label} holds "${needle}", got: ${haystack}`,
        haystack !== undefined && matches(haystack, needle)
    )
const lacks = (label: string, haystack: string | undefined, needle: Needle) =>
    check(
        `${label} must not hold "${needle}", got: ${haystack}`,
        haystack !== undefined && !matches(haystack, needle)
    )

const noError = (run: Run) => check(`tool did not error, got: ${errorText(run)}`, !errored(run))
const anyErrored = (run: Run) => check('tool errored', errored(run))
const allErrored = (run: Run) =>
    check(
        'every call errored',
        run.results.length > 0 && run.results.every(result => result.isError)
    )
const errorHas = (run: Run, needle: Needle) => holds('error', errorText(run), needle)
const errorLacks = (run: Run, needle: Needle) => lacks('error', errorText(run), needle)
const calledTimes = (run: Run, times: number) =>
    check(`tool called ${times}x, got ${run.calls.length}`, run.calls.length === times)
const answerHas = (run: Run, needle: Needle) => holds('answer', run.answer, needle)
const answerLacks = (run: Run, needle: Needle) => lacks('answer', run.answer, needle)
const noDigits = (run: Run) => answerLacks(run, /\d/)
const notJust = (run: Run, word: string) =>
    check(`answer is not just ${word}`, run.answer.trim() !== word)

const covered = (run: Run, ...want: Coverage[]) => {
    const got = shaped(run)?.covered
    return check(
        `covered is ${want.join('|')}, got: ${got}`,
        want.some(value => got === value)
    )
}

const saysHas = (run: Run, needle: Needle) => holds('subagent answer', shaped(run)?.answer, needle)
const saysNoDigits = (run: Run) => lacks('subagent answer', shaped(run)?.answer, /\d/)
const cites = (run: Run, needle: Needle) =>
    check(
        `evidence holds "${needle}", got: ${shaped(run)?.evidence.join(' | ')}`,
        shaped(run)?.evidence.some(line => matches(line, needle)) === true
    )
const headerHas = (run: Run, needle: Needle) => holds('header', split(run).header, needle)
const headerLacks = (run: Run, needle: Needle) => lacks('header', split(run).header, needle)

type Suite<T extends Case> = {
    cases: T[]
    run: (testCase: T) => Promise<Run>
    transcripts: string
    label?: (testCase: T) => string
}

// `ROUNDS=n` repeats every case; argv[2] narrows to one case. Returns how many runs failed.
const runCases = async <T extends Case>(suite: Suite<T>): Promise<number> => {
    const only = process.argv[2]
    const rounds = Number(process.env.ROUNDS ?? '1')

    if (!Number.isInteger(rounds) || rounds < 1)
        throw new Error(`ROUNDS must be a whole number, got ${process.env.ROUNDS}`)

    const label = suite.label ?? ((testCase: T) => testCase.name)
    let failed = 0
    mkdirSync(suite.transcripts, {recursive: true})

    for (let round = 1; round <= rounds; round++)
        for (const testCase of suite.cases.filter(c => only === undefined || c.name === only)) {
            const started = performance.now()
            const run = await suite.run(testCase)
            const suffix = rounds === 1 ? '' : `-${round}`
            writeFileSync(join(suite.transcripts, `${label(testCase)}${suffix}.jsonl`), run.events)
            const problems = failures(testCase.checks(run))
            const seconds = Math.round((performance.now() - started) / 1000)
            console.log(
                `${problems.length === 0 ? 'PASS' : 'FAIL'} ${label(testCase)}${suffix} (${seconds}s)`
            )
            for (const problem of problems) console.log(`  ${problem}`)
            if (problems.length > 0) failed++
        }

    return failed
}

export {
    allErrored,
    answerHas,
    answerLacks,
    anyErrored,
    calledTimes,
    check,
    cites,
    covered,
    errorHas,
    errorLacks,
    errorText,
    headerHas,
    headerLacks,
    noDigits,
    noError,
    notJust,
    resultText,
    runCases,
    saysHas,
    saysNoDigits,
    shaped
}
export type {Case, Check}
