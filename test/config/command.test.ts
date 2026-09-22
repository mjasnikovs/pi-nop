import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import type {
    ExtensionAPI,
    ExtensionCommandContext,
    RegisteredCommand
} from '@earendil-works/pi-coding-agent'
import {rmSync} from 'node:fs'
import {join} from 'node:path'
import {agentDir, getAgentDir, useAgentDir} from '../agentDir'

const actual = await import('@earendil-works/pi-coding-agent')
await mock.module('@earendil-works/pi-coding-agent', () => ({...actual, getAgentDir}))

const {loadConfig} = await import('../../src/config/config')
const {default: register} = await import('../../src/config/command')
const configPath = join(agentDir, 'pi-nop.json')

type Command = Omit<RegisteredCommand, 'name' | 'sourceInfo'>

const registerCommand = mock((_name: string, _command: Command) => undefined)
const pi = {registerCommand} as unknown as ExtensionAPI
const getAvailable = mock(() => [
    {provider: 'acme', id: 'fast'},
    {provider: 'acme', id: 'slow'}
])
const answers: Array<string | undefined> = []
const select = mock((_title: string, _options: string[]) => Promise.resolve(answers.shift()))
const notify = mock((_message: string, _level: string) => undefined)
const ctx = {
    modelRegistry: {getAvailable},
    ui: {select, notify}
} as unknown as ExtensionCommandContext

const registered = (): Command => {
    registerCommand.mockClear()
    register(pi)
    expect(registerCommand).toHaveBeenCalledTimes(1)
    const [name, command] = registerCommand.mock.calls[0] as [string, Command]
    expect(name).toBe('nop-config')
    return command
}
useAgentDir()

beforeEach(() => {
    answers.length = 0
    rmSync(configPath, {force: true})
    select.mockClear()
    notify.mockClear()
})

afterAll(() => {
    mock.restore()
})

describe('nop-config command', () => {
    test('describes itself', () => {
        expect(registered().description).toBe('Choose the subagent model and thinking level')
    })

    test('offers inherit plus every available model, then the thinking levels', async () => {
        answers.push('acme/slow', 'high')

        await registered().handler('', ctx)

        expect(select.mock.calls).toEqual([
            ['Subagent model', ['inherit', 'acme/fast', 'acme/slow']],
            [
                'Subagent thinking',
                ['inherit', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
            ]
        ])
        expect(loadConfig()).toEqual({model: 'acme/slow', thinkingLevel: 'high'})
        expect(notify).toHaveBeenCalledWith('Subagent: acme/slow / high', 'info')
    })

    test('stores inherit as no model', async () => {
        answers.push('inherit', 'low')

        await registered().handler('', ctx)

        expect(loadConfig()).toEqual({thinkingLevel: 'low'})
        expect(notify).toHaveBeenCalledWith('Subagent: inherit / low', 'info')
    })

    test('stores inherit as no thinking level', async () => {
        answers.push('acme/fast', 'inherit')

        await registered().handler('', ctx)

        expect(loadConfig()).toEqual({model: 'acme/fast'})
        expect(notify).toHaveBeenCalledWith('Subagent: acme/fast / inherit', 'info')
    })

    test('saves nothing when the model dialog is cancelled', async () => {
        answers.push(undefined)

        await registered().handler('', ctx)

        expect(select).toHaveBeenCalledTimes(1)
        expect(loadConfig()).toEqual({})
        expect(notify).not.toHaveBeenCalled()
    })

    test('saves nothing when the thinking dialog is cancelled', async () => {
        answers.push('acme/fast', undefined)

        await registered().handler('', ctx)

        expect(select).toHaveBeenCalledTimes(2)
        expect(loadConfig()).toEqual({})
        expect(notify).not.toHaveBeenCalled()
    })
})
