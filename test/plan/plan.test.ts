import {beforeEach, describe, expect, mock, test} from 'bun:test'
import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExtensionContext,
    Theme
} from '@earendil-works/pi-coding-agent'

import type {SubagentTask, SubagentUpdate} from '../../src/subagent/subagent'
import {acceptRules, AskErrors, handOverMessage} from '../../src/plan/ask'
import {goalPrompt} from '../../src/plan/goal'

type Reply = {content: {text: string}[]}
type Tool = {execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<Reply>}
type SessionOptions = {prompt: string; customTools: Tool[]; waitingTools: string[]}

const prompt = mock((_task: SubagentTask, _signal: unknown, onUpdate: SubagentUpdate) => {
    onUpdate?.({type: 'turn', text: 'reading', details: {} as never})
    return Promise.resolve({text: 'GOAL: Fix the typo.', details: {} as never})
})
const dispose = mock(() => undefined)
const subagentSession = mock((_options: SessionOptions) => ({prompt, dispose}))
const configuredOptions = mock(() => ({cwd: '/repo', prompt: '', tools: []}))
await mock.module('../../src/subagent/subagent', () => ({
    subagentSession,
    configuredOptions
}))

const plain = (text: string) => text
const actual = await import('@earendil-works/pi-coding-agent')
await mock.module('@earendil-works/pi-coding-agent', () => ({
    ...actual,
    getSelectListTheme: () => ({
        selectedPrefix: plain,
        selectedText: plain,
        description: plain,
        scrollInfo: plain,
        noMatch: plain
    })
}))

const {
    default: register,
    closeTitle,
    keepLabel,
    noGoalLine,
    stopLabel,
    tuiOnly
} = await import('../../src/plan/plan')

type Panel = {
    render(width: number): string[]
    handleInput(data: string): void
    dispose?(): void
}
type Factory = (tui: unknown, theme: Theme, keybindings: unknown, done: () => void) => Panel
type Options = {onHandle: (handle: {setHidden: (hidden: boolean) => void}) => void}
type Command = {handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>}
type Handler = (event: unknown, ctx: ExtensionContext) => unknown

const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text
} as unknown as Theme
const enter = '\r'
const escape = '\x1b'
const width = 60
const handlers = new Map<string, Handler>()
const commands = new Map<string, Command>()
const appendEntry = mock((_type: string, _data: unknown) => undefined)
const sendUserMessage = mock((_text: string) => undefined)
const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (name: string, command: Command) => commands.set(name, command),
    appendEntry,
    sendUserMessage
} as unknown as ExtensionAPI

let panel: Panel | undefined
let closed = false
const tui = {requestRender: (): void => undefined, terminal: {rows: 60}}
// Like pi, closing the overlay disposes its component.
const setHidden = mock((_hidden: boolean) => undefined)
const custom = mock((factory: Factory, options: Options) => {
    const component = factory(tui, theme, undefined, () => {
        closed = true
        component.dispose?.()
    })
    panel = component
    options.onHandle({setHidden})
    return Promise.resolve()
})
const select = mock((_title: string, _options: string[]) =>
    Promise.resolve<string | undefined>(stopLabel)
)
const notify = mock((_text: string, _level: string) => undefined)
const entries: {type: string; customType?: string; data?: unknown}[] = []
const ctx = {
    mode: 'tui',
    ui: {custom, notify, select, theme},
    sessionManager: {getBranch: () => entries}
} as unknown as ExtensionContext & ExtensionCommandContext

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const type = (text: string) => {
    for (const char of text) panel?.handleInput(char)
}

const screen = () => panel?.render(width).join('\n') ?? ''
const lastEntry = () => appendEntry.mock.calls.at(-1)?.[1]
const down = '\x1b[B'
const none = {file: 'NONE', line: 'NONE'}
const greeting = {question: 'Which greeting?', options: ['Hello', 'Hi'], evidence: none}
const testing = {question: 'Add a test?', options: ['Yes', 'No'], evidence: none}
const turn = {type: 'turn' as const, text: '', details: {} as never}
const done = {text: 'DONE', details: {} as never}
const goalEntry = {request: 'fix', goal: 'Fix the typo.', decisions: [], asked: false}
const tool = (): Tool => subagentSession.mock.calls.at(-1)?.[0].customTools[0] as Tool

const taskOf = (call: number): string => {
    const task = prompt.mock.calls.at(call)?.[0] ?? ''

    return typeof task === 'string' ? task : task()
}

const asks = (said: string[], ...questions: unknown[]) =>
    prompt.mockImplementationOnce(async (_task, signal, onUpdate) => {
        for (const question of questions) {
            const reply = await tool().execute('id', question, signal as AbortSignal)
            said.push(reply.content[0]?.text ?? '')
            onUpdate?.(turn)
        }

        return done
    })

const openWithGoal = async () => {
    await commands.get('plan')?.handler('fix', ctx)
    await settle()
}

const pick = (row: number) => {
    for (let i = 0; i < row; i += 1) panel?.handleInput(down)
    panel?.handleInput(enter)
}
beforeEach(() => {
    handlers.clear()
    commands.clear()
    entries.length = 0
    panel = undefined
    closed = false
    const fakes = [prompt, dispose, subagentSession, appendEntry, sendUserMessage, custom, notify]
    for (const fn of [...fakes, select, setHidden]) fn.mockClear()
    register(pi)
})

describe('/plan', () => {
    test('opens the panel as an overlay', async () => {
        await commands.get('plan')?.handler('', ctx)

        expect(custom).toHaveBeenCalledTimes(1)
        expect(custom.mock.calls[0]?.[1]).toMatchObject({
            overlay: true,
            overlayOptions: {width: '80%'}
        })
        expect(custom.mock.calls[0]?.[1]).not.toHaveProperty('overlayOptions.maxHeight')
        expect(screen()).toContain('PLAN')
    })

    test('outside the TUI it only warns', async () => {
        await commands.get('plan')?.handler('', {...ctx, mode: 'rpc'} as never)

        expect(notify).toHaveBeenCalledWith(tuiOnly, 'warning')
        expect(custom).not.toHaveBeenCalled()
    })

    test('typed text runs the goal subagent and shows the goal', async () => {
        await commands.get('plan')?.handler('', ctx)
        type('fix the greeting')
        panel?.handleInput(enter)
        await settle()

        expect(prompt.mock.calls[0]?.[0]).toBe('Request: fix the greeting')
        expect(subagentSession.mock.calls[0]?.[0].prompt).toBe(goalPrompt)
        expect(screen()).toContain('Fix the typo.')
        expect(lastEntry()).toEqual({
            ...goalEntry,
            request: 'fix the greeting',
            accepted: false
        })
    })

    test('changes go to the same session as only the change line', async () => {
        await commands.get('plan')?.handler('', ctx)
        type('fix the greeting')
        panel?.handleInput(enter)
        await settle()
        type('add a test too')
        panel?.handleInput(enter)
        await settle()
        type('keep it short')
        panel?.handleInput(enter)
        await settle()

        expect(subagentSession).toHaveBeenCalledTimes(1)
        expect(prompt.mock.calls.map(call => call[0])).toEqual([
            'Request: fix the greeting',
            'Change asked by the user: add a test too',
            'Change asked by the user: keep it short'
        ])
        expect(dispose).not.toHaveBeenCalled()
    })

    test('close disposes the session and a fresh /plan opens a new one', async () => {
        await commands.get('plan')?.handler('', ctx)
        type('fix the greeting')
        panel?.handleInput(enter)
        await settle()
        panel?.handleInput(escape)
        await settle()

        expect(closed).toBe(true)
        expect(dispose).toHaveBeenCalledTimes(1)

        await commands.get('plan')?.handler('', ctx)
        type('add a test too')
        panel?.handleInput(enter)
        await settle()

        expect(subagentSession).toHaveBeenCalledTimes(2)
        expect(prompt.mock.calls[1]?.[0]).toBe(
            'Request: fix the greeting\nCurrent goal: Fix the typo.\nChange asked by the user: add a test too'
        )
    })

    test('a failed change disposes the session and the next one starts cold', async () => {
        await commands.get('plan')?.handler('', ctx)
        type('fix the greeting')
        panel?.handleInput(enter)
        await settle()
        prompt.mockRejectedValueOnce(new Error('Subagent run failed: boom'))
        type('add a test too')
        panel?.handleInput(enter)
        await settle()

        expect(dispose).toHaveBeenCalledTimes(1)
        expect(screen()).toContain('boom')

        type('add a test too')
        panel?.handleInput(enter)
        await settle()

        expect(subagentSession).toHaveBeenCalledTimes(2)
        expect(prompt.mock.calls[2]?.[0]).toContain('Request: fix the greeting')
    })

    test('a change after a reply with no goal resends the shown goal', async () => {
        await commands.get('plan')?.handler('', ctx)
        type('fix the greeting')
        panel?.handleInput(enter)
        await settle()
        prompt.mockResolvedValueOnce({text: 'I changed it to use emoji.', details: {} as never})
        type('use emoji')
        panel?.handleInput(enter)
        await settle()
        type('keep it short')
        panel?.handleInput(enter)
        await settle()

        expect(subagentSession).toHaveBeenCalledTimes(1)
        expect(prompt.mock.calls[2]?.[0]).toBe(
            'Request: fix the greeting\nCurrent goal: Fix the typo.\nChange asked by the user: keep it short'
        )
    })

    test('text-less turns show a count that restarts per change', async () => {
        const silent = {type: 'turn' as const, text: '', details: {} as never}
        prompt.mockImplementationOnce((_task, _signal, onUpdate) => {
            onUpdate?.(silent)
            onUpdate?.(silent)
            return Promise.resolve({text: 'GOAL: Fix the typo.', details: {} as never})
        })
        await commands.get('plan')?.handler('fix', ctx)
        await settle()

        prompt.mockImplementationOnce((_task, _signal, onUpdate) => {
            onUpdate?.(silent)
            return new Promise(() => undefined)
        })
        type('also rename it')
        panel?.handleInput(enter)

        expect(screen()).toContain('turn 1')
        panel?.handleInput(escape)
        await settle()
    })

    test('queue notices do not count as turns', async () => {
        prompt.mockImplementationOnce((_task, _signal, onUpdate) => {
            onUpdate?.({type: 'queued'})
            onUpdate?.({type: 'started'})
            return new Promise(() => undefined)
        })
        await commands.get('plan')?.handler('', ctx)
        type('fix')
        panel?.handleInput(enter)

        expect(screen()).toContain('starting…')
        expect(screen()).not.toContain('turn')
        panel?.handleInput(escape)
        await settle()
    })

    test('accept clears a stale error', async () => {
        await commands.get('plan')?.handler('fix', ctx)
        await settle()
        prompt.mockResolvedValueOnce({text: 'I did it.', details: {} as never})
        type('also rename it')
        panel?.handleInput(enter)
        await settle()
        expect(screen()).toContain(noGoalLine.slice(0, 30))

        panel?.handleInput(enter)

        expect(screen()).not.toContain(noGoalLine.slice(0, 30))
        expect(lastEntry()).toMatchObject({accepted: true})
        expect(taskOf(-1)).toBe(`Request: fix\nCurrent goal: Fix the typo.\n\n${acceptRules}`)
        await settle()
    })

    test('text after the command starts a new plan over a saved one', async () => {
        entries.push({
            type: 'custom',
            customType: 'plan-mode',
            data: {request: 'old', goal: 'Old goal.', accepted: true}
        })
        handlers.get('session_start')?.({}, ctx)
        await commands.get('plan')?.handler('fix the greeting', ctx)
        await settle()

        expect(prompt.mock.calls[0]?.[0]).toBe('Request: fix the greeting')
        expect(lastEntry()).toEqual({
            ...goalEntry,
            request: 'fix the greeting',
            accepted: false
        })
    })

    test('the spinner repaints the panel while the subagent runs', async () => {
        prompt.mockImplementationOnce(() => new Promise(() => undefined))
        await commands.get('plan')?.handler('', ctx)
        type('fix')
        panel?.handleInput(enter)
        const repainted = new Promise<void>(resolve => (tui.requestRender = resolve))
        screen()

        await repainted
        tui.requestRender = () => undefined
        panel?.handleInput(escape)
        await settle()
    })

    test('the command returns while the panel is open', async () => {
        custom.mockReturnValueOnce(new Promise(() => undefined))
        const returned = commands
            .get('plan')
            ?.handler('', ctx)
            .then(() => true)
        expect(await Promise.race([returned, settle()])).toBe(true)
    })

    test('a panel that fails to open reports it and stops the run', async () => {
        prompt.mockImplementationOnce(() => new Promise(() => undefined))
        custom.mockReturnValueOnce(Promise.reject(new Error('boom')))
        await commands.get('plan')?.handler('fix', ctx)
        await settle()

        expect(notify).toHaveBeenCalledWith('Error: boom', 'error')
        expect(dispose).toHaveBeenCalledTimes(1)
    })

    test('pi shutting down disposes the session', async () => {
        await commands.get('plan')?.handler('', ctx)
        type('fix the greeting')
        panel?.handleInput(enter)
        await settle()
        handlers.get('session_shutdown')?.({reason: 'quit'}, ctx)

        expect(dispose).toHaveBeenCalledTimes(1)
    })

    test('text after the command is the first request and shows in the panel', async () => {
        let finish: (result: {text: string; details: never}) => void = () => undefined
        prompt.mockImplementationOnce(
            () => new Promise(resolve => (finish = resolve as typeof finish))
        )
        await commands.get('plan')?.handler('fix the greeting', ctx)

        expect(prompt.mock.calls[0]?.[0]).toBe('Request: fix the greeting')
        expect(screen()).toContain('subagent')
        expect(screen()).toContain('fix the greeting')
        expect(screen()).not.toContain('Type what you want done.')

        finish({text: 'GOAL: Fix the typo.', details: {} as never})
        await settle()

        expect(screen()).toContain('Fix the typo.')
        expect(appendEntry).toHaveBeenCalledTimes(1)
    })

    test('a session with no saved plan writes no empty entry before the first goal', async () => {
        handlers.get('session_start')?.({}, ctx)
        await openWithGoal()

        expect(appendEntry).toHaveBeenCalledTimes(1)
        expect(lastEntry()).toMatchObject({goal: 'Fix the typo.'})
    })

    test('no GOAL line shows an error and keeps the old state', async () => {
        prompt.mockResolvedValueOnce({text: 'I did it.', details: {} as never})
        await commands.get('plan')?.handler('', ctx)
        type('fix')
        panel?.handleInput(enter)
        await settle()

        expect(screen()).toContain(noGoalLine.slice(0, 30))
        expect(appendEntry).not.toHaveBeenCalled()
    })

    test('a failed run shows its message', async () => {
        prompt.mockRejectedValueOnce(new Error('No model selected'))
        await commands.get('plan')?.handler('', ctx)
        type('fix')
        panel?.handleInput(enter)
        await settle()

        expect(screen()).toContain('No model selected')
    })

    test('accept then hand over sends the goal to the main context', async () => {
        await commands.get('plan')?.handler('', ctx)
        type('fix')
        panel?.handleInput(enter)
        await settle()
        prompt.mockResolvedValueOnce(done)
        panel?.handleInput(enter)
        await settle()
        expect(lastEntry()).toEqual({...goalEntry, accepted: true, asked: true})
        expect(screen()).toContain('✓ GOAL')

        panel?.handleInput(enter)
        expect(closed).toBe(true)
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(sendUserMessage).toHaveBeenCalledWith('Fix the typo.')
        expect(lastEntry()).toEqual({accepted: false, decisions: [], asked: false})
    })

    test('accept runs the questions in the same session, with the tool in it from the start', async () => {
        await openWithGoal()
        prompt.mockImplementationOnce(() => new Promise(() => undefined))
        panel?.handleInput(enter)

        expect(subagentSession).toHaveBeenCalledTimes(1)
        expect(subagentSession.mock.calls[0]?.[0]).toMatchObject({
            customTools: [{name: 'ask_user'}],
            waitingTools: ['ask_user']
        })
        expect(taskOf(-1)).toBe(acceptRules)
        expect(screen()).toContain('✓ GOAL')
        expect(screen()).toContain('subagent')
        panel?.handleInput(escape)
        await settle()
    })

    test('a question waits for a row and the answer is saved before the run goes on', async () => {
        const said: string[] = []
        await openWithGoal()
        asks(said, greeting)
        panel?.handleInput(enter)
        await settle()

        expect(screen()).toContain('Which greeting?')
        expect(screen()).not.toContain('subagent ·')

        panel?.handleInput(enter)
        expect(lastEntry()).toMatchObject({
            decisions: [{question: 'Which greeting?', answer: 'Hello'}],
            asked: false
        })
        await settle()

        expect(said).toEqual(['Answer: Hello'])
        expect(lastEntry()).toMatchObject({asked: true})
        expect(screen()).toContain('✓ Hello')
        expect(screen()).not.toContain('Ask questions')
    })

    test('the questions task is read again on a restart, with the answers given so far', async () => {
        await openWithGoal()
        asks([], greeting)
        panel?.handleInput(enter)
        await settle()
        expect(taskOf(-1)).toBe(acceptRules)

        panel?.handleInput(enter)
        expect(taskOf(-1)).toBe(
            ['Decisions so far:', 'Q1: Which greeting?', 'A1: Hello', '', acceptRules].join('\n')
        )
        await settle()
    })

    test('a second enter on an answered question saves nothing more', async () => {
        await openWithGoal()
        asks([], greeting)
        panel?.handleInput(enter)
        await settle()
        panel?.handleInput(enter)
        panel?.handleInput(enter)
        await settle()

        expect(lastEntry()).toMatchObject({
            decisions: [{question: 'Which greeting?', answer: 'Hello'}]
        })
    })

    test('a question stopped by a guard leaves the screen and cannot be answered', async () => {
        const said: string[] = []
        const guard = new AbortController()
        await openWithGoal()
        prompt.mockImplementationOnce(async () => {
            said.push(await tool().execute('id', greeting, guard.signal).then(String, String))
            return new Promise(() => undefined)
        })
        panel?.handleInput(enter)
        await settle()
        expect(screen()).toContain('Which greeting?')

        guard.abort()
        await settle()
        const saved = appendEntry.mock.calls.length
        panel?.handleInput(enter)

        expect(said).toEqual([`Error: ${AskErrors.Closed}`])
        expect(screen()).not.toContain('Which greeting?')
        expect(screen()).toContain('subagent ·')
        expect(appendEntry).toHaveBeenCalledTimes(saved)
        panel?.handleInput(escape)
        await settle()
    })

    test('the panel fits a short terminal and keeps its rows and input', async () => {
        tui.terminal.rows = 16
        await openWithGoal()
        asks([], {...greeting, options: ['a', 'b', 'c', 'd', 'e']})
        panel?.handleInput(enter)
        await settle()
        const lines = panel?.render(width) ?? []
        tui.terminal.rows = 60

        expect(lines.length).toBeLessThanOrEqual(16)
        expect(lines.join('\n')).toContain('Finish questions')
        expect(lines.join('\n')).toContain('> ')
        expect(lines.at(-1)).toStartWith('╰')
        panel?.handleInput(escape)
        await settle()
    })

    test('typed text answers the question, and the answers go with the goal on hand over', async () => {
        const said: string[] = []
        await openWithGoal()
        asks(said, greeting)
        panel?.handleInput(enter)
        await settle()
        type('Hey there')
        panel?.handleInput(enter)
        await settle()
        panel?.handleInput(enter)

        const decisions = [{question: 'Which greeting?', answer: 'Hey there'}]
        expect(said).toEqual(['Answer: Hey there'])
        expect(sendUserMessage).toHaveBeenCalledWith(handOverMessage('Fix the typo.', decisions))
        expect(lastEntry()).toEqual({accepted: false, decisions: [], asked: false})
    })

    test('the tool is refused during the goal turn', async () => {
        const said: string[] = []
        prompt.mockImplementationOnce(async () => {
            said.push(await tool().execute('id', greeting).then(String, String))
            return {text: 'GOAL: Fix the typo.', details: {} as never}
        })
        await openWithGoal()

        expect(said).toEqual([`Error: ${AskErrors.NotYet}`])
        expect(screen()).not.toContain('Which greeting?')
    })

    test('a second question in one turn is refused, and allowed in the next', async () => {
        const said: string[] = []
        await openWithGoal()
        prompt.mockImplementationOnce(async (_task, _signal, onUpdate) => {
            const first = tool().execute('a', greeting)
            said.push(await tool().execute('b', testing).then(String, String))
            said.push((await first).content[0]?.text ?? '')
            onUpdate?.(turn)
            said.push((await tool().execute('c', testing)).content[0]?.text ?? '')
            return done
        })
        panel?.handleInput(enter)
        await settle()
        panel?.handleInput(enter)
        await settle()
        expect(screen()).toContain('Add a test?')
        pick(1)
        await settle()

        expect(said).toEqual([`Error: ${AskErrors.OnePerCall}`, 'Answer: Hello', 'Answer: No'])
    })

    test('finish stops the run, closes the session and ends the step', async () => {
        const said: string[] = []
        await openWithGoal()
        prompt.mockImplementationOnce(async (_task, signal) => {
            said.push(
                await tool()
                    .execute('id', greeting, signal as AbortSignal)
                    .then(String, String)
            )
            throw new Error('Subagent aborted')
        })
        panel?.handleInput(enter)
        await settle()
        pick(2)
        await settle()

        expect(said).toEqual([`Error: ${AskErrors.Closed}`])
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(lastEntry()).toEqual({...goalEntry, accepted: true, asked: true})
        expect(screen()).not.toContain('Which greeting?')
        expect(screen()).not.toContain('Subagent aborted')
        expect(screen()).toContain('Send to main context')
    })

    test('change goal drops the answers and the next change starts a fresh session', async () => {
        const said: string[] = []
        await openWithGoal()
        asks(said, greeting, testing)
        panel?.handleInput(enter)
        await settle()
        panel?.handleInput(enter)
        await settle()
        pick(3)
        await settle()

        expect(dispose).toHaveBeenCalledTimes(1)
        expect(lastEntry()).toEqual({...goalEntry, accepted: false})
        expect(screen()).toContain('Accept the goal')
        expect(screen()).not.toContain('✓ Hello')

        type('also rename it')
        panel?.handleInput(enter)
        await settle()
        expect(subagentSession).toHaveBeenCalledTimes(2)
        expect(taskOf(-1)).toBe(
            'Request: fix\nCurrent goal: Fix the typo.\nChange asked by the user: also rename it'
        )
    })

    test('a failed questions run keeps the answers, and ask questions restarts cold', async () => {
        await openWithGoal()
        prompt.mockImplementationOnce(async () => {
            await tool().execute('id', greeting)
            throw new Error('Subagent run failed: boom')
        })
        panel?.handleInput(enter)
        await settle()
        panel?.handleInput(enter)
        await settle()

        expect(screen()).toContain('boom')
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(lastEntry()).toMatchObject({accepted: true, asked: false})
        expect(screen()).toContain('✓ Hello')

        prompt.mockImplementationOnce(() => new Promise(() => undefined))
        panel?.handleInput(enter)
        expect(subagentSession).toHaveBeenCalledTimes(2)
        expect(taskOf(-1)).toBe(
            [
                'Request: fix',
                'Current goal: Fix the typo.',
                'Decisions so far:',
                'Q1: Which greeting?',
                'A1: Hello',
                '',
                acceptRules
            ].join('\n')
        )
        panel?.handleInput(escape)
        await settle()
    })

    test('a question asked again gets the saved answer without showing', async () => {
        const said: string[] = []
        const decisions = [{question: 'Which greeting?', answer: 'Hello'}]
        entries.push({
            type: 'custom',
            customType: 'plan-mode',
            data: {...goalEntry, accepted: true, decisions}
        })
        handlers.get('session_start')?.({}, ctx)
        await commands.get('plan')?.handler('', ctx)
        asks(said, {...greeting, question: 'which  greeting?'})
        panel?.handleInput(enter)
        await settle()

        expect(said).toEqual(['Answer: Hello'])
        expect(lastEntry()).toEqual({...goalEntry, accepted: true, decisions, asked: true})
    })

    test('escape asks first, and keep planning leaves the run alone', async () => {
        let signal: AbortSignal | undefined
        prompt.mockImplementationOnce((_task, given) => {
            signal = given as AbortSignal
            return new Promise(() => undefined)
        })
        select.mockResolvedValueOnce(keepLabel)
        await commands.get('plan')?.handler('', ctx)
        type('fix')
        panel?.handleInput(enter)
        panel?.handleInput(escape)
        await settle()

        expect(select).toHaveBeenCalledWith(closeTitle, [keepLabel, stopLabel])
        expect(setHidden.mock.calls).toEqual([[true], [false]])
        expect(closed).toBe(false)
        expect(signal?.aborted).toBe(false)
        expect(dispose).not.toHaveBeenCalled()
        select.mockResolvedValueOnce(stopLabel)
        panel?.handleInput(escape)
        await settle()
    })

    test('escape in the dialog keeps the panel open', async () => {
        select.mockResolvedValueOnce(undefined)
        await commands.get('plan')?.handler('', ctx)
        panel?.handleInput(escape)
        await settle()

        expect(select).toHaveBeenCalledTimes(1)
        expect(closed).toBe(false)
    })

    test('the close row closes without asking', async () => {
        await commands.get('plan')?.handler('fix', ctx)
        await settle()
        panel?.handleInput('\x1b[A')
        panel?.handleInput(enter)

        expect(select).not.toHaveBeenCalled()
        expect(closed).toBe(true)
    })

    test('escape closes and aborts a running subagent', async () => {
        let signal: AbortSignal | undefined
        prompt.mockImplementationOnce((_task, given) => {
            signal = given as AbortSignal
            return new Promise(() => undefined)
        })
        await commands.get('plan')?.handler('', ctx)
        type('fix')
        panel?.handleInput(enter)
        panel?.handleInput(escape)
        await settle()

        expect(closed).toBe(true)
        expect(signal?.aborted).toBe(true)
        expect(dispose).toHaveBeenCalledTimes(1)
    })

    test('reopening shows the saved goal', async () => {
        entries.push({
            type: 'custom',
            customType: 'plan-mode',
            data: {request: 'fix', goal: 'Fix the typo.', accepted: true}
        })
        handlers.get('session_start')?.({}, ctx)
        await commands.get('plan')?.handler('', ctx)

        expect(screen()).toContain('✓ GOAL')
        expect(screen()).toContain('Fix the typo.')
        expect(screen()).toContain('Ask questions')
    })
})
