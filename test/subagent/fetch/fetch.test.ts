import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import type {ExtensionAPI, ExtensionContext, ToolDefinition} from '@earendil-works/pi-coding-agent'
import type {TObject, TString} from 'typebox'
import type {SubagentUpdate} from '../../../src/subagent/subagent'

type FetchTool = ToolDefinition<TObject<{url: TString; query: TString}>>

const details = {task: 'task', lastAssistantText: 'answer', elapsedMs: 1}
const update = {content: [{type: 'text', text: 'partial'}], details}
const runSubagent = mock((_task: string, _signal: unknown, onUpdate: SubagentUpdate) => {
    onUpdate?.(update as Parameters<NonNullable<SubagentUpdate>>[0])
    return Promise.resolve({text: 'answer', details})
})
const options = {cwd: '/cwd', prompt: '', tools: ['read'], thinkingLevel: 'low'}
const configuredOptions = mock((_ctx: ExtensionContext) => options)
await mock.module('../../../src/subagent/subagent', () => ({runSubagent, configuredOptions}))

const realFetch = globalThis.fetch
const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(new Response('page')))
afterAll(() => {
    globalThis.fetch = realFetch
    mock.restore()
})

const {
    buildTask,
    extractionPrompt,
    default: register
} = await import('../../../src/subagent/fetch/fetch')

const registerTool = mock((_tool: FetchTool) => undefined)
const pi = {registerTool} as unknown as ExtensionAPI
const ctx = {cwd: '/cwd'} as unknown as ExtensionContext
const onUpdate = mock((_update: unknown) => undefined)

const tool = (): FetchTool => {
    register(pi)
    return registerTool.mock.calls[0][0]
}
beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockClear()
    fetchMock.mockImplementation(() => Promise.resolve(new Response('page')))
    runSubagent.mockClear()
    configuredOptions.mockClear()
    registerTool.mockClear()
    onUpdate.mockClear()
})

describe('fetch tool', () => {
    test('registers under the name subagent-fetch', () => {
        expect(tool().name).toBe('subagent-fetch')
    })

    test('fetches the page and hands it to the subagent with no tools', async () => {
        const signal = new AbortController().signal
        const params = {url: 'https://example.com', query: 'what'}
        const result = await tool().execute('id', params, signal, onUpdate, ctx)
        expect(fetchMock).toHaveBeenCalledWith('https://example.com', {signal})
        expect(configuredOptions).toHaveBeenCalledWith(ctx)
        expect(runSubagent).toHaveBeenCalledWith(
            buildTask('what', 'https://example.com', 'page'),
            signal,
            onUpdate,
            {...options, prompt: extractionPrompt, tools: []}
        )
        expect(result).toEqual({content: [{type: 'text', text: 'answer'}], details})
    })

    test('forwards progress to onUpdate', async () => {
        await tool().execute(
            'id',
            {url: 'https://example.com', query: 'q'},
            undefined,
            onUpdate,
            ctx
        )

        expect(onUpdate).toHaveBeenCalledWith(update)
    })

    test('puts query, url and page in the task', () => {
        expect(buildTask('q', 'u', 'p')).toBe('<query>q</query>\n<url>u</url>\n<page>\np\n</page>')
    })

    test('throws on a non-ok response', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(new Response('', {status: 404, statusText: 'Not Found'}))
        )

        await expect(
            tool().execute('id', {url: 'https://example.com', query: 'q'}, undefined, onUpdate, ctx)
        ).rejects.toThrow('Fetch failed: 404 Not Found')
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('throws on an invalid url', async () => {
        globalThis.fetch = realFetch

        await expect(
            tool().execute('id', {url: 'not a url', query: 'q'}, undefined, onUpdate, ctx)
        ).rejects.toThrow()
        expect(runSubagent).not.toHaveBeenCalled()
    })
})
