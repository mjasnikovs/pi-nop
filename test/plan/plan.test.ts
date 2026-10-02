import {beforeEach, describe, expect, mock, test} from 'bun:test'
import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExtensionContext,
    Theme
} from '@earendil-works/pi-coding-agent'

import type {SubagentUpdate} from '../../src/subagent/subagent'
import {goalPrompt} from '../../src/plan/goal'

const prompt = mock((_task: string, _signal: unknown, onUpdate: SubagentUpdate) => {
    onUpdate?.({type: 'turn', text: 'reading', details: {} as never})
    return Promise.resolve({text: 'GOAL: Fix the typo.', details: {} as never})
})
const dispose = mock(() => undefined)
const subagentSession = mock((_options: {prompt: string}) => ({prompt, dispose}))
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
const tui = {requestRender: (): void => undefined}
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

        expect(prompt.mock.calls[0]?.[0]).toBe('Request: fix the greeting')
        expect(subagentSession.mock.calls[0]?.[0].prompt).toBe(goalPrompt)
        expect(screen()).toContain('Fix the typo.')
        expect(lastEntry()).toEqual({
            request: 'fix the greeting',
            goal: 'Fix the typo.',
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
            request: 'fix the greeting',
            goal: 'Fix the typo.',
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
        panel?.handleInput(enter)
        expect(lastEntry()).toMatchObject({accepted: true})
        expect(screen()).toContain('✓ GOAL')

        panel?.handleInput(enter)
        expect(closed).toBe(true)
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(sendUserMessage).toHaveBeenCalledWith('Fix the typo.')
        expect(lastEntry()).toEqual({accepted: false})
    })

    test('a change after accept drops the check mark while it runs', async () => {
        await commands.get('plan')?.handler('', ctx)
        type('fix')
        panel?.handleInput(enter)
        await settle()
        panel?.handleInput(enter)
        expect(screen()).toContain('✓ GOAL')

        prompt.mockImplementationOnce(() => new Promise(() => undefined))
        type('also rename it')
        panel?.handleInput(enter)
        expect(screen()).not.toContain('✓ GOAL')
        expect(screen()).toContain('Fix the typo.')
        panel?.handleInput(escape)
        await settle()
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
    })
})
