import {beforeEach, describe, expect, mock, test} from 'bun:test'
import type {ExtensionAPI, ToolDefinition} from '@earendil-works/pi-coding-agent'
import register from '../src/index'

const on = mock((_event: string, _handler: unknown) => () => undefined)
const registerTool = mock((_tool: ToolDefinition) => undefined)
const registerCommand = mock((_name: string) => undefined)
const pi = {on, registerTool, registerCommand} as unknown as ExtensionAPI
beforeEach(() => {
    on.mockClear()
    registerTool.mockClear()
    registerCommand.mockClear()
})

describe('extension', () => {
    test('registers the subagent, fetch, docs and search tools', () => {
        register(pi)

        expect(registerTool).toHaveBeenCalledTimes(4)
        const names = registerTool.mock.calls.map(([tool]) => (tool as ToolDefinition).name)
        expect(names).toEqual(['subagent', 'subagent-fetch', 'subagent-docs', 'web-search'])
    })

    test('registers the config and plan commands', () => {
        register(pi)

        const names = registerCommand.mock.calls.map(([name]) => name)
        expect(names).toEqual(['nop-config', 'plan'])
    })

    test('only plan listens to session start', () => {
        register(pi)

        const events = on.mock.calls.map(([event]) => event)
        expect(events.filter(event => event === 'session_start')).toHaveLength(1)
    })
})
