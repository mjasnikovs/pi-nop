import {beforeEach, describe, expect, mock, spyOn, test} from 'bun:test'
import {execFileSync} from 'node:child_process'

import {
    acceptRules,
    AskErrors,
    askTool,
    askToolName,
    distinctOptions,
    handOverMessage,
    questionsTask,
    quoted,
    sameQuestion
} from '../../src/plan/ask'
import type {AskHost, Question} from '../../src/plan/ask'
import {tempTree} from '../tree'

const greet = 'export const greet = (name) => `Helo, ${name}!`'
const cwd = tempTree({
    'src/greet.js': `${greet}\n\nexport const shout = () => {\r\n    return 1\r\n}\n`,
    'docs/note.md': 'x'
})
const decisions = [
    {question: 'Which greeting?', answer: 'Hello'},
    {question: 'Add a test?', answer: 'No'}
]
describe('sameQuestion', () => {
    test('ignores case and spacing, not wording', () => {
        expect(sameQuestion('Which  greeting?\n', ' which greeting?')).toBe(true)
        expect(sameQuestion('Which greeting?', 'What greeting?')).toBe(false)
    })
})

describe('distinctOptions', () => {
    test('trims, and drops blanks and repeats', () => {
        expect(distinctOptions([' a ', '', 'b', 'a', '  '])).toEqual(['a', 'b'])
    })

    test('an option of escape codes alone is a blank', () => {
        expect(distinctOptions(['\x1b[31m\x1b[0m', '\x1b[1ma\x1b[0m', 'b'])).toEqual(['a', 'b'])
    })
})

describe('quoted', () => {
    const source = 'src/greet.js'
    test('a whole line of the file passes, whatever its indent and line ending', async () => {
        expect(await quoted(cwd, {file: source, line: `  ${greet}  `}, undefined)).toBe(true)
        expect(await quoted(cwd, {file: source, line: 'return 1'}, undefined)).toBe(true)
    })

    test('the path is found the way the read tool finds it', async () => {
        expect(await quoted(cwd, {file: `@${source}`, line: greet}, undefined)).toBe(true)
        expect(await quoted(cwd, {file: `file://${cwd}/${source}`, line: greet}, undefined)).toBe(
            true
        )
    })

    test.skipIf(Bun.which('mkfifo') === null)(
        'a pipe is refused instead of read to no end',
        async () => {
            execFileSync('mkfifo', [`${cwd}/pipe`])

            expect(await quoted(cwd, {file: 'pipe', line: greet}, undefined)).toBe(false)
        }
    )

    test('an abort during the read ends the check', async () => {
        expect(await quoted(cwd, {file: source, line: greet}, AbortSignal.abort())).toBe(false)
    })

    test('NONE in both fields passes, in one field it does not', async () => {
        expect(await quoted(cwd, {file: 'NONE', line: ' NONE '}, undefined)).toBe(true)
        expect(await quoted(cwd, {file: 'NONE', line: greet}, undefined)).toBe(false)
        expect(await quoted(cwd, {file: source, line: 'NONE'}, undefined)).toBe(false)
    })

    test('part of a line, two lines or an empty quote fail', async () => {
        expect(await quoted(cwd, {file: source, line: 'export const greet'}, undefined)).toBe(false)
        expect(await quoted(cwd, {file: source, line: `${greet}\n`.repeat(2)}, undefined)).toBe(
            false
        )
        expect(await quoted(cwd, {file: source, line: '  '}, undefined)).toBe(false)
    })

    test('a missing file, a directory and a path through a file fail without throwing', async () => {
        expect(await quoted(cwd, {file: 'src/panel.js', line: greet}, undefined)).toBe(false)
        expect(await quoted(cwd, {file: 'src', line: greet}, undefined)).toBe(false)
        expect(await quoted(cwd, {file: 'src/greet.js/x', line: greet}, undefined)).toBe(false)
    })

    test('a file outside cwd counts, since the read tool can open it', async () => {
        expect(await quoted(`${cwd}/docs`, {file: '../src/greet.js', line: greet}, undefined)).toBe(
            true
        )
        expect(await quoted('/', {file: `${cwd}/src/greet.js`, line: greet}, undefined)).toBe(true)
    })
})

describe('questionsTask', () => {
    test('a session that holds the goal gets only the accept rules', () => {
        expect(questionsTask({}, [])).toBe(acceptRules)
        expect(acceptRules).toContain(`call ${askToolName} with one question`)
    })

    test('a fresh session gets the request, the goal and the answers first', () => {
        expect(questionsTask({request: 'nicer', goal: 'Be nice.'}, decisions)).toBe(
            [
                'Request: nicer',
                'Current goal: Be nice.',
                'Decisions so far:',
                'Q1: Which greeting?',
                'A1: Hello',
                'Q2: Add a test?',
                'A2: No',
                '',
                acceptRules
            ].join('\n')
        )
    })

    test('answers alone are sent when the session holds the goal', () => {
        expect(questionsTask({}, decisions.slice(0, 1))).toBe(
            ['Decisions so far:', 'Q1: Which greeting?', 'A1: Hello', '', acceptRules].join('\n')
        )
    })
})

describe('handOverMessage', () => {
    test('with no answers it is the goal alone', () => {
        expect(handOverMessage('Be nice.', [], '', [])).toBe('Be nice.')
    })

    test('answers follow the goal as settled decisions', () => {
        const message = handOverMessage('Be nice.', decisions, '', [])
        expect(message).toStartWith('Be nice.\n\nPLANNING DECISIONS — these were settled')
        expect(message).toEndWith(
            'as usual.\n\nQ1: Which greeting?\nA1: Hello\nQ2: Add a test?\nA2: No'
        )
    })

    const plan = 'STEPS:\n1. Greet.\nFILES:\n- a.js (existing)'
    test('the steps come after a blank line', () => {
        expect(handOverMessage('Be nice.', [], plan, [])).toBe(`Be nice.\n\n${plan}`)
        expect(handOverMessage('Be nice.', decisions, plan, [])).toEndWith(`A2: No\n\n${plan}`)
    })

    test('typed changes come last, one line each, as measured', () => {
        expect(handOverMessage('Be nice.', [], plan, ['No README.', 'Short test.'])).toBe(
            `Be nice.\n\n${plan}\n\nChange asked by the user: No README.\nChange asked by the user: Short test.`
        )
    })
})

const until = async (ready: () => boolean): Promise<void> => {
    while (!ready()) await new Promise(resolve => setImmediate(resolve))
}
describe('askTool', () => {
    const open = mock(() => true)
    const claim = mock(() => true)
    const stored = mock((_question: string): string | undefined => undefined)
    const hide = mock(() => undefined)
    const show = mock((_question: Question, answer: (text: string) => void) => {
        answer('Hello')
        return hide
    })
    const host: AskHost = {cwd, open, claim, stored, show}
    const params = {
        question: 'Which greeting?',
        options: ['Hello', 'Hi', 'Hello'],
        evidence: {file: 'src/greet.js', line: greet}
    }
    const run = (over: Partial<typeof params> = {}, signal?: AbortSignal) =>
        askTool(host).execute('id', {...params, ...over}, signal, undefined, undefined as never)
    beforeEach(() => {
        for (const fn of [open, claim, stored, show, hide]) fn.mockClear()
    })

    test('shows the question with distinct options and returns the answer', async () => {
        const result = await run()
        expect(result.content).toEqual([{type: 'text', text: 'Answer: Hello'}])
        expect(result.details).toEqual({repeat: false})
        expect(show.mock.calls[0]?.[0]).toEqual({
            question: 'Which greeting?',
            options: ['Hello', 'Hi'],
            evidence: params.evidence
        })
        expect(askTool(host).name).toBe('ask_user')
        // pi runs a batch one by one if any tool in it asks for that, which would hold reads back.
        expect(askTool(host).executionMode).toBeUndefined()
    })

    test('NONE evidence is shown as no evidence', async () => {
        await run({evidence: {file: 'NONE', line: 'NONE'}})

        expect(show.mock.calls[0]?.[0].evidence).toBeUndefined()
    })

    test('an answered question gets its stored answer, is not shown and leaves the turn free', async () => {
        stored.mockReturnValueOnce('Hi')
        const result = await run()
        expect(result.content).toEqual([{type: 'text', text: 'Answer: Hi'}])
        expect(result.details).toEqual({repeat: true})
        expect(show).not.toHaveBeenCalled()
        expect(claim).not.toHaveBeenCalled()
    })

    test('a blank question is refused', async () => {
        await expect(run({question: '  '})).rejects.toThrow(AskErrors.Question)
        await expect(run({question: '\x1b[31m \x1b[0m'})).rejects.toThrow(AskErrors.Question)
        expect(show).not.toHaveBeenCalled()
    })

    test('outside a questions run it is refused', async () => {
        open.mockReturnValueOnce(false)

        await expect(run()).rejects.toThrow(AskErrors.NotYet)
        expect(claim).not.toHaveBeenCalled()
    })

    test('a second call in one turn is refused', async () => {
        claim.mockReturnValueOnce(false)

        await expect(run()).rejects.toThrow(AskErrors.OnePerCall)
    })

    test('fewer than two distinct options are refused', async () => {
        await expect(run({options: ['Hello', 'Hello ', '']})).rejects.toThrow(AskErrors.Options)
    })

    test('more than five distinct options are refused before the turn is used', async () => {
        const six = ['a', 'b', 'c', 'd', 'e', 'f']
        await expect(run({options: six})).rejects.toThrow(AskErrors.Options)
        expect(claim).not.toHaveBeenCalled()
        expect(show).not.toHaveBeenCalled()
    })

    test('five distinct options with a repeat are shown', async () => {
        await run({options: ['a', 'b', 'c', 'd', 'e', 'a ']})

        expect(show.mock.calls[0]?.[0].options).toEqual(['a', 'b', 'c', 'd', 'e'])
    })

    test('the option limit reads as measured', () => {
        expect(String(AskErrors.Options)).toBe('Give 2 to 5 options.')
        expect(askTool(host).description).toBe(
            'Ask the user one question. Give 2 to 5 options. Call once per question.'
        )
    })

    test('a quote that is not in the file is refused', async () => {
        await expect(run({evidence: {file: 'src/greet.js', line: 'const greet'}})).rejects.toThrow(
            AskErrors.Evidence
        )
        expect(show).not.toHaveBeenCalled()
        expect(claim).not.toHaveBeenCalled()
    })

    test('an abort that came before the wait ends it without showing the question', async () => {
        await expect(run({}, AbortSignal.abort())).rejects.toThrow(AskErrors.Closed)
        expect(show).not.toHaveBeenCalled()
    })

    test('an abort while the question waits ends the wait', async () => {
        const controller = new AbortController()
        show.mockImplementationOnce(() => hide)
        const waiting = run({}, controller.signal)
        await until(() => show.mock.calls.length === 1)
        controller.abort()

        await expect(waiting).rejects.toThrow(AskErrors.Closed)
        expect(hide).toHaveBeenCalledTimes(1)
    })

    test('an answer takes the abort listener off the signal', async () => {
        const controller = new AbortController()
        const remove = spyOn(controller.signal, 'removeEventListener')
        await run({evidence: {file: 'NONE', line: 'NONE'}}, controller.signal)

        expect(remove).toHaveBeenCalledTimes(1)
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    })
})
