import {beforeEach, describe, expect, mock, test} from 'bun:test'
import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExtensionContext,
    Theme
} from '@earendil-works/pi-coding-agent'

import type {SubagentUpdate} from '../../src/subagent/subagent'
import {goalPrompt} from '../../src/plan/goal'

const runSubagent = mock((_task: string, _signal: unknown, onUpdate: SubagentUpdate) => {
    onUpdate?.({content: [], details: {lastAssistantText: 'reading'} as never})
    return Promise.resolve({text: 'GOAL: Fix the typo.', details: {} as never})
})
const configuredOptions = mock(() => ({cwd: '/repo', prompt: '', tools: []}))
await mock.module('../../src/subagent/subagent', () => ({
    runSubagent,
    configuredOptions,
    safeConfig: () => ({})
}))

const {default: register, noGoalLine, tuiOnly} = await import('../../src/plan/plan')

type Panel = {render(width: number): string[]; handleInput(data: string): void}
type Factory = (tui: unknown, theme: Theme, keybindings: unknown, done: () => void) => Panel
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
const tui = {requestRender: () => undefined}
const custom = mock((factory: Factory, _options: unknown) => {
    panel = factory(tui, theme, undefined, () => {
        closed = true
    })
    return Promise.resolve()
})
const notify = mock((_text: string, _level: string) => undefined)
const entries: {type: string; customType?: string; data?: unknown}[] = []
const ctx = {
    mode: 'tui',
    ui: {custom, notify, theme},
    sessionManager: {getEntries: () => entries}
} as unknown as ExtensionContext & ExtensionCommandContext

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const type = (text: string) => {
    for (const char of text) panel?.handleInput(char)
}

const screen = () => panel?.render(width).join('\n') ?? ''
const lastEntry = () => appendEntry.mock.calls.at(-1)?.[1]
beforeEach(() => {
    handlers.clear()
    commands.clear()
    entries.length = 0
    panel = undefined
    closed = false
    for (const fn of [runSubagent, appendEntry, sendUserMessage, custom, notify]) fn.mockClear()
    register(pi)
})

describe('/plan', () => {
    test('opens the panel as an overlay', async () => {
        await commands.get('plan')?.handler('', ctx)

        expect(custom).toHaveBeenCalledTimes(1)
        expect(custom.mock.calls[0]?.[1]).toEqual({
            overlay: true,
            overlayOptions: {width: '80%', maxHeight: '80%'}
        })
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

        const [task, , , options] = runSubagent.mock.calls[0] as unknown as [
            string,
            unknown,
            unknown,
            {prompt: string}
        ]
        expect(task).toBe('Request: fix the greeting')
        expect(options.prompt).toBe(goalPrompt)
        expect(screen()).toContain('Fix the typo.')
        expect(lastEntry()).toEqual({
            request: 'fix the greeting',
            goal: 'Fix the typo.',
            accepted: false
        })
    })

    test('a second text is a change against the current goal', async () => {
        await commands.get('plan')?.handler('', ctx)
        type('fix the greeting')
        panel?.handleInput(enter)
        await settle()
        type('add a test too')
        panel?.handleInput(enter)
        await settle()

        expect(runSubagent.mock.calls[1]?.[0]).toBe(
            'Request: fix the greeting\nCurrent goal: Fix the typo.\nChange asked by the user: add a test too'
        )
    })

    test('text after the command is the first request and shows in the panel', async () => {
        let finish: (result: {text: string; details: never}) => void = () => undefined
        runSubagent.mockImplementationOnce(
            () => new Promise(resolve => (finish = resolve as typeof finish))
        )
        await commands.get('plan')?.handler('fix the greeting', ctx)

        expect(runSubagent.mock.calls[0]?.[0]).toBe('Request: fix the greeting')
        expect(screen()).toContain('subagent')

        finish({text: 'GOAL: Fix the typo.', details: {} as never})
        await settle()

        expect(screen()).toContain('Fix the typo.')
    })

    test('no GOAL line shows an error and keeps the old state', async () => {
        runSubagent.mockResolvedValueOnce({text: 'I did it.', details: {} as never})
        await commands.get('plan')?.handler('', ctx)
        type('fix')
        panel?.handleInput(enter)
        await settle()

        expect(screen()).toContain(noGoalLine.slice(0, 30))
        expect(appendEntry).not.toHaveBeenCalled()
    })

    test('a failed run shows its message', async () => {
        runSubagent.mockRejectedValueOnce(new Error('No model selected'))
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
        panel?.handleInput(enter)
        expect(lastEntry()).toMatchObject({accepted: true})
        expect(screen()).toContain('✓ GOAL')

        panel?.handleInput(enter)
        expect(closed).toBe(true)
        expect(sendUserMessage).toHaveBeenCalledWith('Fix the typo.')
        expect(lastEntry()).toEqual({accepted: false})
    })

    test('escape closes and aborts a running subagent', async () => {
        let signal: AbortSignal | undefined
        runSubagent.mockImplementationOnce((_task, given) => {
            signal = given as AbortSignal
            return new Promise(() => undefined)
        })
        await commands.get('plan')?.handler('', ctx)
        type('fix')
        panel?.handleInput(enter)
        panel?.handleInput(escape)

        expect(closed).toBe(true)
        expect(signal?.aborted).toBe(true)
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
    })
})
