import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import type {ExtensionAPI, ExtensionContext, ToolDefinition} from '@earendil-works/pi-coding-agent'
import type {Api, Model} from '@earendil-works/pi-ai'
import type {TObject, TOptional, TString} from 'typebox'
import type {SubagentOptions} from '../../../src/subagent/subagent'
import {tempTree as tree} from '../../tree'
import {packument, serveRegistry} from './registry'

type DocsTool = ToolDefinition<
    TObject<{module: TString; query: TString; version: TOptional<TString>}>
>

const details = {task: 'task', lastAssistantText: '', elapsedMs: 1}
let answer = 'COVERED: no\nANSWER: none\nEVIDENCE:'
const runSubagent = mock(
    (_task: string, _signal: unknown, _onUpdate: unknown, _options: SubagentOptions) =>
        Promise.resolve({text: answer, details})
)
let options: Partial<SubagentOptions> = {}
const configuredOptions = mock((ctx: ExtensionContext, _tool: string) => ({
    ...options,
    cwd: ctx.cwd
}))
const {SubagentErrors} = await import('../../../src/subagent/subagent')
await mock.module('../../../src/subagent/subagent', () => ({
    runSubagent,
    configuredOptions,
    SubagentErrors
}))

const registry = serveRegistry({'/lib': packument('lib', '2.0.0', {'1.0.0': {}, '2.0.0': {}})})
process.env.npm_config_registry = `http://127.0.0.1:${registry.port}/`
afterAll(() => {
    delete process.env.npm_config_registry
    void registry.stop()
})

const {default: register} = await import('../../../src/subagent/docs/docs')
const registerTool = mock((_tool: DocsTool) => undefined)
const pi = {registerTool} as unknown as ExtensionAPI
const window = (contextWindow: number) => ({contextWindow}) as Model<Api>

const tool = (): DocsTool => {
    register(pi)
    return registerTool.mock.calls[0][0]
}

const project = (range: string, files: Record<string, string | object> = {}) =>
    tree({
        'package.json': {name: 'app', dependencies: {lib: range}},
        'node_modules/lib/package.json': {name: 'lib', version: '1.0.0', types: 'index.d.ts'},
        'node_modules/lib/index.d.ts': 'export declare const pad: (text: string) => string',
        ...files
    })

const ask = async (cwd: string, module = 'lib') => {
    const result = await tool().execute('id', {module, query: 'how to pad'}, undefined, undefined, {
        cwd
    } as unknown as ExtensionContext)
    const [task, , , used] = runSubagent.mock.calls[0]
    return {text: (result.content[0] as {text: string}).text, task, used}
}
beforeEach(() => {
    answer = 'COVERED: no\nANSWER: none\nEVIDENCE:'
    options = {prompt: '', tools: ['read'], model: window(100_000)} as Partial<SubagentOptions>
    runSubagent.mockClear()
    registerTool.mockClear()
})

describe('docs tool', () => {
    test('hands the whole package inline with no tools, and heads the checked answer', async () => {
        answer =
            'COVERED: yes\nANSWER: pad\nEVIDENCE:\nexport declare const pad: (text: string) => string'
        const cwd = project('workspace:*')
        const {text, task, used} = await ask(cwd)
        expect(task).toContain(
            '<query>how to pad</query>\n<module>lib</module>\n<package>lib@1.0.0</package>'
        )
        expect(task).toContain(`<entry>${cwd}`)
        expect(task).toContain('<file path="lib/index.d.ts">\nexport declare const pad')
        expect(used).toMatchObject({tools: [], model: options.model})
        expect(text).toStartWith('PACKAGE: lib@1.0.0 (installed)\nDECLARED: workspace:*')
        expect(text).not.toContain('LATEST')
        expect(text).toEndWith(answer)
    })

    test('lists the file paths for the subagent to read when the contents do not fit', async () => {
        const readme = 'pad\n'.repeat(2000)
        options.model = window(500)
        const cwd = project('workspace:*', {'node_modules/lib/README.md': readme})
        const {task, used} = await ask(cwd)
        expect(task).toContain(`<file>${cwd}/node_modules/lib/README.md</file>`)
        expect(task).not.toContain(readme)
        expect(used).toMatchObject({tools: ['read']})
        expect(used.prompt).toContain('Read and grep the files listed')
    })

    test('a package too big even as a file list, or no model, is an error before any run', async () => {
        options.model = window(1)
        await expect(ask(project('workspace:*'))).rejects.toThrow(
            'package too big for the subagent model context window, even as a file list. Files: 2'
        )
        options.model = undefined
        await expect(ask(project('workspace:*'))).rejects.toThrow(SubagentErrors.NoModel)
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('a package with no entry is sent without one', async () => {
        const cwd = tree({'node_modules/lib/package.json': {name: 'lib', version: '1.0.0'}})
        const {task} = await ask(cwd)
        expect(task).not.toContain('<entry>')
    })

    test('a registry package gets latest for its installed version', async () => {
        const {text} = await ask(project('^1'))
        expect(text).toContain('\nLATEST: 2.0.0\n')
    })

    test('types alone ask the registry about the package asked for', async () => {
        const cwd = tree({
            'package.json': {name: 'app', devDependencies: {'@types/lib': '^1'}},
            'node_modules/@types/lib/package.json': {name: '@types/lib', version: '1.0.0'},
            'node_modules/@types/lib/index.d.ts': 'export declare const pad: 1'
        })
        const {text} = await ask(cwd)
        expect(text).toStartWith('PACKAGE: lib (not installed); read from @types/lib@1.0.0')
        expect(text).toContain('\nLATEST: 2.0.0\n')
    })

    test('a runtime module is declared as its types package and is not looked up', async () => {
        const cwd = tree({
            'package.json': {name: 'app', devDependencies: {'@types/node': '^26'}},
            'node_modules/@types/node/package.json': {
                name: '@types/node',
                version: '26.0.0',
                types: 'index.d.ts'
            },
            'node_modules/@types/node/index.d.ts': 'declare module "fs" {}'
        })
        const {text} = await ask(cwd, 'node:fs')
        expect(text).toContain('DECLARED: ^26 in')
        expect(text).not.toContain('LATEST')
    })
})
