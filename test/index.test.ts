import {beforeEach, describe, expect, mock, test} from 'bun:test'
import type {
    ExtensionAPI,
    ExtensionContext,
    ExtensionHandler,
    SessionStartEvent,
    ToolDefinition
} from '@earendil-works/pi-coding-agent'
import register from '../src/index'

type SessionStartHandler = ExtensionHandler<SessionStartEvent>

const on = mock((_event: string, _handler: SessionStartHandler) => () => undefined)
const registerTool = mock((_tool: ToolDefinition) => undefined)
const registerCommand = mock((_name: string) => undefined)
const notify = mock((_message: string, _level: string) => undefined)
const pi = {on, registerTool, registerCommand} as unknown as ExtensionAPI
const ctx = {ui: {notify}} as unknown as ExtensionContext
const event: SessionStartEvent = {type: 'session_start', reason: 'startup'}
beforeEach(() => {
    on.mockClear()
    registerTool.mockClear()
    registerCommand.mockClear()
    notify.mockClear()
})

describe('extension', () => {
    test('registers the subagent, fetch, docs and search tools', () => {
        register(pi)

        expect(registerTool).toHaveBeenCalledTimes(4)
        const names = registerTool.mock.calls.map(([tool]) => (tool as ToolDefinition).name)
        expect(names).toEqual(['subagent', 'subagent-fetch', 'subagent-docs', 'web-search'])
    })

    test('registers the config command', () => {
        register(pi)

        expect(registerCommand).toHaveBeenCalledTimes(1)
        const [name] = registerCommand.mock.calls[0] as [string]
        expect(name).toBe('nop-config')
    })

    test('notifies on session start', () => {
        register(pi)

        expect(on).toHaveBeenCalledTimes(1)
        const [name, handler] = on.mock.calls[0] as [string, SessionStartHandler]
        expect(name).toBe('session_start')

        void handler(event, ctx)
        expect(notify).toHaveBeenCalledWith('Extension loaded!', 'info')
    })
})
