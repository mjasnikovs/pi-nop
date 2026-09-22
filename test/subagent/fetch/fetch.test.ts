import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import type {ExtensionAPI, ExtensionContext, ToolDefinition} from '@earendil-works/pi-coding-agent'
import type {Api, Model} from '@earendil-works/pi-ai'
import type {TObject, TString} from 'typebox'
import type {SubagentOptions, SubagentUpdate} from '../../../src/subagent/subagent'

type FetchTool = ToolDefinition<TObject<{url: TString; query: TString}>>

const details = {task: 'task', lastAssistantText: 'answer', elapsedMs: 1}
const update = {content: [{type: 'text', text: 'partial'}], details}
const runSubagent = mock((_task: string, _signal: unknown, onUpdate: SubagentUpdate) => {
    onUpdate?.(update as Parameters<NonNullable<SubagentUpdate>>[0])
    return Promise.resolve({text: 'answer', details})
})
const model = {contextWindow: 1000} as Model<Api>
const options = {
    cwd: '/cwd',
    prompt: '',
    tools: ['read'],
    thinkingLevel: 'low',
    model
} as Partial<SubagentOptions>
const configuredOptions = mock((_ctx: ExtensionContext) => options)
const {SubagentErrors} = await import('../../../src/subagent/subagent')
await mock.module('../../../src/subagent/subagent', () => ({
    runSubagent,
    configuredOptions,
    SubagentErrors
}))

const page = (body: string, url = 'https://example.com/final'): Response => {
    const response = new Response(body, {headers: {'content-type': 'text/plain'}})
    Object.defineProperty(response, 'url', {value: url})
    return response
}

const realFetch = globalThis.fetch
const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(page('page')))
afterAll(() => {
    globalThis.fetch = realFetch
    mock.restore()
})

const {
    buildTask,
    extractionPrompt,
    taskShare,
    default: register
} = await import('../../../src/subagent/fetch/fetch')

const registerTool = mock((_tool: FetchTool) => undefined)
const pi = {registerTool} as unknown as ExtensionAPI
const ctx = {cwd: '/cwd'} as unknown as ExtensionContext
const onUpdate = mock((_update: unknown) => undefined)
const params = {url: 'https://example.com', query: 'what'}

const tool = (): FetchTool => {
    register(pi)
    return registerTool.mock.calls[0][0]
}
beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockClear()
    fetchMock.mockImplementation(() => Promise.resolve(page('page')))
    runSubagent.mockClear()
    configuredOptions.mockClear()
    configuredOptions.mockImplementation(() => options)
    registerTool.mockClear()
    onUpdate.mockClear()
})

describe('fetch tool', () => {
    test('registers under the name subagent-fetch', () => {
        expect(tool().name).toBe('subagent-fetch')
    })

    test('fetches the page and hands the digest to the subagent with no tools', async () => {
        const signal = new AbortController().signal
        const result = await tool().execute('id', params, signal, onUpdate, ctx)
        expect(fetchMock).toHaveBeenCalledWith('https://example.com', {signal})
        expect(configuredOptions).toHaveBeenCalledWith(ctx)
        expect(runSubagent).toHaveBeenCalledWith(
            buildTask('what', 'https://example.com/final', 'page'),
            signal,
            onUpdate,
            {...options, prompt: extractionPrompt, tools: []}
        )
        expect(result).toEqual({
            content: [{type: 'text', text: 'answer'}],
            details: {...details, task: 'what https://example.com'}
        })
    })

    test('renders through the shared subagent TUI', () => {
        const {renderCall, renderResult} = tool()
        expect(renderCall).toBeInstanceOf(Function)
        expect(renderResult).toBeInstanceOf(Function)
    })

    test('titles the row with query and url', () => {
        const {renderCall} = tool()
        const render = {
            args: params,
            state: {},
            invalidate: () => undefined,
            executionStarted: true
        }
        const theme = {fg: (_c: string, text: string) => text, bold: (text: string) => text}
        const out =
            renderCall?.(params, theme as never, render as never)
                ?.render(80)
                .join('\n') ?? ''
        expect(out).toContain('subagent-fetch')
        expect(out).toContain('what https://example.com')
    })

    test('forwards progress to onUpdate', async () => {
        await tool().execute('id', params, undefined, onUpdate, ctx)

        expect(onUpdate).toHaveBeenCalledWith(update)
    })

    test('puts query, url and page in the task', () => {
        expect(buildTask('q', 'u', 'p')).toBe('<query>q</query>\n<url>u</url>\n<page>\np\n</page>')
    })

    test('throws when the task does not fit the model context window', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(page('x'.repeat(model.contextWindow * taskShare * 4)))
        )

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            SubagentErrors.PageTooBig
        )
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('throws when no model is selected', async () => {
        configuredOptions.mockImplementation(() => ({...options, model: undefined}))

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            SubagentErrors.NoModel
        )
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('throws on a non-ok response', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(new Response('', {status: 404, statusText: 'Not Found'}))
        )

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            'Fetch failed: 404 Not Found'
        )
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('surfaces the cause when fetch itself fails', async () => {
        const cause = new Error('Hostname/IP does not match certificate')
        fetchMock.mockImplementation(() => Promise.reject(new TypeError('fetch failed', {cause})))

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            'Fetch failed: fetch failed: Hostname/IP does not match certificate'
        )
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('reports a cancel during the fetch as an abort', async () => {
        const controller = new AbortController()
        fetchMock.mockImplementation(() => {
            controller.abort()
            return Promise.reject(new DOMException('aborted', 'AbortError'))
        })

        await expect(
            tool().execute('id', params, controller.signal, onUpdate, ctx)
        ).rejects.toThrow(SubagentErrors.Aborted)
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('titles a half-streamed call without the word undefined', () => {
        const {renderCall} = tool()
        const render = {args: {query: 'what'}, state: {}, invalidate: () => undefined}
        const theme = {fg: (_c: string, text: string) => text, bold: (text: string) => text}
        const out =
            renderCall?.({query: 'what'} as never, theme as never, render as never)
                ?.render(80)
                .join('\n') ?? ''
        expect(out).toContain('subagent-fetch - what')
        expect(out).not.toContain('undefined')
    })

    test('throws on an invalid url', async () => {
        await expect(
            tool().execute('id', {url: 'not a url', query: 'q'}, undefined, onUpdate, ctx)
        ).rejects.toThrow()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('rejects schemes other than http and https', async () => {
        await expect(
            tool().execute('id', {url: 'file:///etc/passwd', query: 'q'}, undefined, onUpdate, ctx)
        ).rejects.toThrow('Fetch failed: unsupported protocol file:')
        expect(fetchMock).not.toHaveBeenCalled()
        expect(runSubagent).not.toHaveBeenCalled()
    })
})
