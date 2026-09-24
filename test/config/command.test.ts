import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import type {
    ExtensionAPI,
    ExtensionCommandContext,
    RegisteredCommand
} from '@earendil-works/pi-coding-agent'
import type {Component} from '@earendil-works/pi-tui'
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {agentDir, getAgentDir, useAgentDir} from '../agentDir'

const plain = (text: string) => text
const actual = await import('@earendil-works/pi-coding-agent')
await mock.module('@earendil-works/pi-coding-agent', () => ({
    ...actual,
    getAgentDir,
    getSettingsListTheme: () => ({
        label: plain,
        value: plain,
        description: plain,
        cursor: '> ',
        hint: plain
    }),
    getSelectListTheme: () => ({
        selectedPrefix: plain,
        selectedText: plain,
        description: plain,
        scrollInfo: plain,
        noMatch: plain
    })
}))

const {loadConfig} = await import('../../src/config/config')
const {version} = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as {
    version: string
}
const {
    applyChange,
    dropStaleModels,
    panelItems,
    default: register
} = await import('../../src/config/command')
const configPath = join(agentDir, 'pi-nop.json')

type Command = Omit<RegisteredCommand, 'name' | 'sourceInfo'>
type Panel = Component & {handleInput(data: string): void}
type Factory = (tui: unknown, theme: Theme, keybindings: unknown, done: () => void) => Panel
type Theme = {fg: (color: string, text: string) => string}

const theme: Theme = {fg: (color, text) => `${color}(${text})`}
const enter = '\r'
const down = '\x1b[B'
const escape = '\x1b'
const models = ['acme/fast', 'acme/slow']
const registerCommand = mock((_name: string, _command: Command) => undefined)
const pi = {registerCommand} as unknown as ExtensionAPI
const getAvailable = mock(() => [
    {provider: 'acme', id: 'fast'},
    {provider: 'acme', id: 'slow'}
])
const notify = mock((_message: string, _level: string) => undefined)
const custom = mock((_factory: Factory, _options: unknown) => Promise.resolve(undefined))
const makeCtx = (mode = 'tui', scopedModels: unknown[] = []) =>
    ({
        mode,
        scopedModels,
        modelRegistry: {getAvailable},
        ui: {notify, custom}
    }) as unknown as ExtensionCommandContext

const registered = (): Command => {
    registerCommand.mockClear()
    register(pi)
    expect(registerCommand).toHaveBeenCalledTimes(1)
    const [name, command] = registerCommand.mock.calls[0] as [string, Command]
    expect(name).toBe('nop-config')
    return command
}

// Runs the handler and hands back the panel it built, with the done callback captured.
const openPanel = async (ctx = makeCtx()) => {
    const done = mock(() => undefined)
    const run = registered().handler('', ctx)
    expect(custom).toHaveBeenCalledTimes(1)
    const [factory, options] = custom.mock.calls[0] as [Factory, unknown]
    expect(options).toEqual({overlay: true})
    return {panel: factory(undefined, theme, undefined, done), done, run}
}
useAgentDir()

beforeEach(() => {
    rmSync(configPath, {force: true})
    notify.mockClear()
    custom.mockClear()
    getAvailable.mockClear()
})

afterAll(() => {
    mock.restore()
})

describe('panelItems', () => {
    test('builds a painted header, a model and a thinking row per tool, then the engine', () => {
        const items = panelItems(
            {'subagent-fetch': {model: 'acme/slow', thinkingLevel: 'high'}},
            models,
            text => `<${text}>`
        )
        expect(items.map(item => [item.id, item.label, item.currentValue])).toEqual([
            ['header:subagent', '<SUBAGENT>', ''],
            ['subagent.model', 'model', 'inherit'],
            ['subagent.thinkingLevel', 'thinking', 'inherit'],
            ['gap:subagent-fetch', '', ''],
            ['header:subagent-fetch', '<SUBAGENT-FETCH>', ''],
            ['subagent-fetch.model', 'model', 'acme/slow'],
            ['subagent-fetch.thinkingLevel', 'thinking', 'high'],
            ['gap:web-search', '', ''],
            ['header:web-search', '<WEB-SEARCH>', ''],
            ['web-search.engine', 'engine', 'exa']
        ])
        expect(items[9]?.values).toEqual(['exa', 'brave', 'ddg'])
        expect(panelItems({'web-search': {engine: 'ddg'}}, models)[9]?.currentValue).toBe('ddg')
        expect(panelItems({}, models)[0]?.label).toBe('SUBAGENT')
        expect(items[2]?.values).toEqual([
            'inherit',
            'off',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max'
        ])
        expect(items[1]?.values).toBeUndefined()
        expect(items[2]?.submenu).toBeUndefined()
    })

    test('the model submenu opens on inherit, or on inherit when the current model is not offered', () => {
        const [, row] = panelItems({subagent: {model: 'acme/gone'}}, models)
        const done = mock((_value?: string) => undefined)
        const onInherit = row?.submenu?.('inherit', done) as Panel
        expect(onInherit.render(40)[0]).toContain('inherit')
        onInherit.handleInput(enter)
        expect(done).toHaveBeenLastCalledWith('inherit')

        const onGone = row?.submenu?.('acme/gone', done) as Panel
        onGone.handleInput(enter)
        expect(done).toHaveBeenLastCalledWith('inherit')
    })

    test('the model submenu lists inherit and every model, opened on the current one', () => {
        const [, row] = panelItems({subagent: {model: 'acme/slow'}}, models)
        const done = mock((_value?: string) => undefined)
        const list = row?.submenu?.('acme/slow', done) as Panel
        expect(list.render(40).join('\n')).toContain('acme/slow')
        list.handleInput(enter)
        expect(done).toHaveBeenCalledWith('acme/slow')

        list.handleInput(down)
        list.handleInput(enter)
        expect(done).toHaveBeenLastCalledWith('inherit')

        list.handleInput(escape)
        expect(done).toHaveBeenLastCalledWith()
    })
})

describe('applyChange', () => {
    test('sets a field and leaves the other tool alone', () => {
        const config = {subagent: {thinkingLevel: 'low'}} as const
        expect(applyChange(config, 'subagent-fetch.model', 'acme/fast')).toEqual({
            subagent: {thinkingLevel: 'low'},
            'subagent-fetch': {model: 'acme/fast'}
        })
        expect(applyChange(config, 'subagent.model', 'acme/fast')).toEqual({
            subagent: {thinkingLevel: 'low', model: 'acme/fast'}
        })
    })

    test('sets a thinking level on a tool with no entry', () => {
        expect(applyChange({}, 'subagent.thinkingLevel', 'high')).toEqual({
            subagent: {thinkingLevel: 'high'}
        })
    })

    test('re-setting the same value or inheriting an unset field changes nothing', () => {
        const config = {subagent: {model: 'acme/fast'}, 'subagent-fetch': {model: 'acme/slow'}}
        expect(applyChange(config, 'subagent.model', 'acme/fast')).toEqual(config)
        expect(applyChange(config, 'subagent.thinkingLevel', 'inherit')).toEqual(config)
        expect(applyChange(config, 'subagent-fetch.thinkingLevel', 'inherit')).toEqual(config)
        expect(applyChange(config, 'subagent.model', 'inherit')).toEqual({
            'subagent-fetch': {model: 'acme/slow'}
        })
    })

    test('sets the search engine and keeps the tools', () => {
        const config = {subagent: {model: 'acme/fast'}} as const
        expect(applyChange(config, 'web-search.engine', 'brave')).toEqual({
            ...config,
            'web-search': {engine: 'brave'}
        })
        expect(() => applyChange(config, 'web-search.engine', 'bing')).toThrow('Parse')
    })

    test('inherit clears the field and drops an emptied tool', () => {
        const config = {subagent: {model: 'acme/fast', thinkingLevel: 'low'}} as const
        expect(applyChange(config, 'subagent.model', 'inherit')).toEqual({
            subagent: {thinkingLevel: 'low'}
        })
        expect(applyChange({subagent: {model: 'acme/fast'}}, 'subagent.model', 'inherit')).toEqual(
            {}
        )
        expect(applyChange({}, 'subagent.model', 'inherit')).toEqual({})
    })
})

describe('dropStaleModels', () => {
    test('drops a model that is not offered and keeps the rest', () => {
        expect(
            dropStaleModels(
                {
                    subagent: {model: 'acme/gone', thinkingLevel: 'low'},
                    'subagent-fetch': {model: 'acme/fast'}
                },
                models
            )
        ).toEqual({subagent: {thinkingLevel: 'low'}, 'subagent-fetch': {model: 'acme/fast'}})
        expect(dropStaleModels({subagent: {thinkingLevel: 'low'}}, models)).toEqual({
            subagent: {thinkingLevel: 'low'}
        })
        expect(
            dropStaleModels(
                {subagent: {model: 'acme/fast'}, 'subagent-fetch': {model: 'acme/gone'}},
                models
            )
        ).toEqual({subagent: {model: 'acme/fast'}})
        expect(
            dropStaleModels(
                {subagent: {model: 'acme/gone'}, 'subagent-fetch': {model: 'x/y'}},
                models
            )
        ).toEqual({})
    })

    test('leaves every model alone when none is available', () => {
        const config = {subagent: {model: 'acme/gone'}, 'subagent-fetch': {model: 'x/y'}}
        expect(dropStaleModels(config, [])).toEqual(config)
    })
})

describe('nop-config command', () => {
    test('describes itself', () => {
        expect(registered().description).toBe(
            'Choose the model and thinking level for each subagent tool, and the web search engine'
        )
    })

    test('outside the tui it prints the current values and opens nothing', async () => {
        writeFileSync(configPath, '{"subagent":{"model":"acme/fast"}}')

        await registered().handler('', makeCtx('rpc'))

        expect(custom).not.toHaveBeenCalled()
        expect(notify).toHaveBeenCalledWith(
            'subagent.model: acme/fast\n'
                + 'subagent.thinkingLevel: inherit\n'
                + 'subagent-fetch.model: inherit\n'
                + 'subagent-fetch.thinkingLevel: inherit\n'
                + 'web-search.engine: exa',
            'info'
        )
    })

    test('outside the tui a broken file warns and prints inherit for every row', async () => {
        writeFileSync(configPath, 'nope')

        await registered().handler('', makeCtx('rpc'))

        expect(notify.mock.calls.map(([, level]) => level)).toEqual(['warning', 'info'])
        expect(notify.mock.calls[1]?.[0]).toBe(
            'subagent.model: inherit\n'
                + 'subagent.thinkingLevel: inherit\n'
                + 'subagent-fetch.model: inherit\n'
                + 'subagent-fetch.thinkingLevel: inherit\n'
                + 'web-search.engine: exa'
        )
    })

    test('outside the tui a stale model prints as inherit and the file is left alone', async () => {
        writeFileSync(configPath, '{"subagent":{"model":"acme/gone"}}')

        await registered().handler('', makeCtx('rpc'))

        expect(notify.mock.calls[0]?.[0]).toStartWith('subagent.model: inherit')
        expect(loadConfig()).toEqual({subagent: {model: 'acme/gone'}})
    })

    test('opens the panel as an overlay and saves each thinking change at once', async () => {
        const {panel, done, run} = await openPanel()
        panel.handleInput(down)
        panel.handleInput(enter)
        expect(loadConfig()).toEqual({subagent: {thinkingLevel: 'off'}})

        panel.handleInput(enter)
        expect(loadConfig()).toEqual({subagent: {thinkingLevel: 'minimal'}})
        expect(panel.render(60).join('\n')).toContain('minimal')

        expect(panel.render(60)[0]).toBe(
            `border(╭─)accent( pi-nop v${version} )border(${'─'.repeat(47 - version.length)}╮)`
        )
        panel.handleInput(escape)
        expect(done).toHaveBeenCalledTimes(1)
        await run
    })

    test('the model row opens a list, picking saves and cancelling does not', async () => {
        const {panel} = await openPanel()
        panel.handleInput(enter)
        panel.handleInput(down)
        panel.handleInput(enter)
        expect(loadConfig()).toEqual({subagent: {model: 'acme/fast'}})

        panel.handleInput(enter)
        panel.handleInput(down)
        panel.handleInput(escape)
        expect(loadConfig()).toEqual({subagent: {model: 'acme/fast'}})
    })

    test('warns once and opens empty when the file is broken', async () => {
        writeFileSync(configPath, 'nope')

        const {panel} = await openPanel()
        expect(notify).toHaveBeenCalledTimes(1)
        expect(notify).toHaveBeenCalledWith(
            'pi-nop config is broken, using the host model and thinking level. Run /nop-config to fix it.',
            'warning'
        )
        expect(panel.render(60).join('\n')).not.toContain('nope')
        panel.handleInput(down)
        panel.handleInput(enter)
        expect(loadConfig()).toEqual({subagent: {thinkingLevel: 'off'}})
    })

    test('shows a stale model as inherit and drops it on the next save', async () => {
        writeFileSync(configPath, '{"subagent":{"model":"acme/gone","thinkingLevel":"low"}}')

        const {panel} = await openPanel()
        expect(panel.render(60).join('\n')).not.toContain('acme/gone')
        panel.handleInput(down)
        panel.handleInput(enter)
        expect(loadConfig()).toEqual({subagent: {thinkingLevel: 'medium'}})
    })

    test('offers the scoped models, but keeps a saved model that is merely out of scope', async () => {
        writeFileSync(configPath, '{"subagent-fetch":{"model":"acme/slow"}}')
        const {panel} = await openPanel(makeCtx('tui', [{model: {provider: 'scope', id: 'only'}}]))
        expect(panel.render(60).join('\n')).toContain('acme/slow')
        panel.handleInput(enter)
        expect(panel.render(60).join('\n')).toContain('scope/only')
        expect(panel.render(60).join('\n')).not.toContain('acme/slow')
        panel.handleInput(down)
        panel.handleInput(enter)
        expect(loadConfig()).toEqual({
            subagent: {model: 'scope/only'},
            'subagent-fetch': {model: 'acme/slow'}
        })
    })

    test('the engine row cycles and saves without touching the tools', async () => {
        writeFileSync(configPath, '{"subagent":{"thinkingLevel":"low"}}')

        const {panel} = await openPanel()
        for (let i = 0; i < 4; i += 1) panel.handleInput(down)
        panel.handleInput(enter)
        expect(loadConfig()).toEqual({
            subagent: {thinkingLevel: 'low'},
            'web-search': {engine: 'brave'}
        })

        panel.handleInput(enter)
        panel.handleInput(enter)
        expect(loadConfig()).toEqual({
            subagent: {thinkingLevel: 'low'},
            'web-search': {engine: 'exa'}
        })
    })

    test('writes nothing until a row changes', async () => {
        await openPanel()

        expect(existsSync(configPath)).toBe(false)
    })
})
