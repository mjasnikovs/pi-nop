import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import type {ExtensionAPI, ExtensionContext, ToolDefinition} from '@earendil-works/pi-coding-agent'
import type {Api, Model} from '@earendil-works/pi-ai'
import type {TObject, TString} from 'typebox'
import type {SubagentOptions, SubagentUpdate} from '../../../src/subagent/subagent'

type FetchTool = ToolDefinition<TObject<{url: TString; query: TString}>>

const answer = 'COVERED: no\nANSWER: answer\nEVIDENCE:'
const details = {task: 'task', lastAssistantText: answer, elapsedMs: 1}
const update = {content: [{type: 'text', text: 'partial'}], details}
const runSubagent = mock((_task: string, _signal: unknown, onUpdate: SubagentUpdate) => {
    onUpdate?.(update as Parameters<NonNullable<SubagentUpdate>>[0])
    return Promise.resolve({text: answer, details})
})
const model = {contextWindow: 1000} as Model<Api>
const options = {
    cwd: '/cwd',
    prompt: '',
    tools: ['read'],
    thinkingLevel: 'low',
    model
} as Partial<SubagentOptions>
const configuredOptions = mock((_nop: unknown, _ctx: ExtensionContext, _tool: string) => options)
const {SubagentErrors} = await import('../../../src/subagent/subagent')
const {FetchErrors} = await import('../../../src/subagent/fetch/errors')
await mock.module('../../../src/subagent/subagent', () => ({
    runSubagent,
    configuredOptions,
    safeConfig: () => ({}),
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

const {taskShare} = await import('../../../src/subagent/budget')
const {buildTask, pagePrompt, default: register} = await import('../../../src/subagent/fetch/fetch')
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
        expect(fetchMock).toHaveBeenCalledWith('https://example.com/', {signal, headers: {}})
        expect(configuredOptions).toHaveBeenCalledWith({}, ctx, 'subagent-fetch')
        expect(runSubagent).toHaveBeenCalledWith(
            buildTask('what', 'https://example.com/final', 'page'),
            signal,
            onUpdate,
            {...options, prompt: pagePrompt, tools: []}
        )
        expect(result).toEqual({
            content: [{type: 'text', text: answer}],
            details: {...details, task: 'what https://example.com'}
        })
    })

    test('rejects an answer that is not in the layout', async () => {
        runSubagent.mockImplementationOnce(() => Promise.resolve({text: 'The port is 1.', details}))

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            'Subagent answer failed verification: not in the answer layout'
        )
    })

    test('rejects a covered answer that cites nothing', async () => {
        const text = 'COVERED: partial\nANSWER: The price is $49.\nEVIDENCE:'
        runSubagent.mockImplementationOnce(() => Promise.resolve({text, details}))

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            'Subagent answer failed verification: no evidence for a covered answer'
        )
    })

    test('rejects evidence the page does not hold', async () => {
        const text = 'COVERED: yes\nANSWER: x\nEVIDENCE:\npage\nmade up\nalso fake'
        runSubagent.mockImplementationOnce(() => Promise.resolve({text, details}))

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            'Subagent answer failed verification: evidence not in the source: made up | also fake'
        )
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

    test('titles the result row with query and url', () => {
        const {renderResult} = tool()
        const render = {args: params, state: {}, invalidate: () => undefined, isError: false}
        const theme = {fg: (_c: string, text: string) => text, bold: (text: string) => text}
        const result = {content: [{type: 'text', text: 'answer'}], details}
        const out =
            renderResult?.(
                result as never,
                {expanded: false} as never,
                theme as never,
                render as never
            )
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
            FetchErrors.PageTooBig
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

    test('throws on a non-ok response with no readable body', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(new Response('', {status: 404, statusText: 'Not Found'}))
        )

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            'Fetch failed: 404 Not Found'
        )
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('names the final url and Retry-After in the status', async () => {
        fetchMock.mockImplementation(() => {
            const response = new Response('', {
                status: 429,
                statusText: 'Too Many',
                headers: {'retry-after': '120'}
            })
            Object.defineProperty(response, 'url', {value: 'https://example.com/elsewhere'})
            return Promise.resolve(response)
        })

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            'Fetch failed: 429 Too Many at https://example.com/elsewhere, Retry-After: 120'
        )
    })

    test('runs the subagent over an error page and raises its answer as the error', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                new Response('moved to /v2', {
                    status: 404,
                    statusText: 'Not Found',
                    headers: {'content-type': 'text/plain'}
                })
            )
        )

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            'Fetch failed: 404 Not Found. Report this status. The error page adds:\nanswer'
        )
        expect(runSubagent.mock.calls[0][0]).toBe(
            '<query>what</query>\n<url>https://example.com/</url>\n<status>404 Not Found</status>\n<page>\nmoved to /v2\n</page>'
        )
    })

    test('drops an error page answer that is not in the layout', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                new Response('moved to /v2', {
                    status: 404,
                    statusText: 'Not Found',
                    headers: {'content-type': 'text/plain'}
                })
            )
        )
        runSubagent.mockImplementationOnce(() =>
            Promise.resolve({text: '```\nCOVERED: yes\nANSWER: moved\nEVIDENCE:\n```', details})
        )

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            /^Fetch failed: 404 Not Found\. Report this status\.$/
        )
    })

    test('turns url credentials into a basic auth header', async () => {
        await tool().execute(
            'id',
            {...params, url: 'https://us%20er:p%40ss@example.com/x'},
            undefined,
            onUpdate,
            ctx
        )

        expect(fetchMock).toHaveBeenCalledWith('https://example.com/x', {
            signal: undefined,
            headers: {authorization: 'Basic ' + Buffer.from('us er:p@ss').toString('base64')}
        })
    })

    test('follows a meta refresh and stops on a loop', async () => {
        const html = (body: string) => {
            const response = new Response(body, {headers: {'content-type': 'text/html'}})
            Object.defineProperty(response, 'url', {value: 'https://example.com/old'})
            return response
        }
        fetchMock.mockImplementationOnce(() =>
            Promise.resolve(
                html(`<meta http-equiv="refresh" content="0; url=/new"><p>Redirecting</p>`)
            )
        )
        fetchMock.mockImplementationOnce(() =>
            Promise.resolve(page('landed', 'https://example.com/new'))
        )
        await tool().execute('id', params, undefined, onUpdate, ctx)
        expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
            'https://example.com/',
            'https://example.com/new'
        ])
        expect(runSubagent.mock.calls[0][0]).toContain('<url>https://example.com/new</url>')

        fetchMock.mockClear()
        runSubagent.mockClear()
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                html(`<meta http-equiv="refresh" content="0; url=/old"><p>Redirecting</p>`)
            )
        )
        await tool().execute('id', params, undefined, onUpdate, ctx)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(runSubagent.mock.calls[0][0]).toContain('Redirecting')
    })

    const refresh = (to: string, from = 'https://example.com/old'): Response => {
        const response = new Response(`<meta http-equiv="refresh" content="0; url=${to}">here`, {
            headers: {'content-type': 'text/html'}
        })
        Object.defineProperty(response, 'url', {value: from})
        return response
    }
    test('drops url credentials when a refresh leaves the origin', async () => {
        fetchMock.mockImplementationOnce(() => Promise.resolve(refresh('/same')))
        fetchMock.mockImplementationOnce(() => Promise.resolve(refresh('https://other.test/')))
        const auth = {authorization: 'Basic ' + Buffer.from('u:p').toString('base64')}
        await tool().execute(
            'id',
            {...params, url: 'https://u:p@example.com/'},
            undefined,
            onUpdate,
            ctx
        )

        expect(fetchMock.mock.calls.map(call => [call[0], call[1]?.headers])).toEqual([
            ['https://example.com/', auth],
            ['https://example.com/same', auth],
            ['https://other.test/', {}]
        ])
    })

    test('ignores a refresh it could not fetch and keeps the page', async () => {
        for (const to of ['data:text/html,x', 'http://[bad', 'https://u:p@example.com/x']) {
            fetchMock.mockImplementation(() => Promise.resolve(refresh(to)))
            runSubagent.mockClear()

            await tool().execute('id', params, undefined, onUpdate, ctx)
            expect(runSubagent.mock.calls[0][0]).toContain('here')
        }

        expect(fetchMock.mock.calls.every(call => call[0].startsWith('https://example.com'))).toBe(
            true
        )
    })

    test('stops a refresh chain at the redirect cap', async () => {
        let hop = 0
        fetchMock.mockImplementation(() => Promise.resolve(refresh(`/hop${(hop += 1)}`)))

        await tool().execute('id', params, undefined, onUpdate, ctx)
        expect(fetchMock).toHaveBeenCalledTimes(21)
        expect(runSubagent.mock.calls[0][0]).toContain('here')
    })

    test('resolves a refresh against the url the redirect landed on', async () => {
        fetchMock.mockImplementationOnce(() =>
            Promise.resolve(refresh('new', 'https://example.com/docs/old'))
        )

        await tool().execute('id', params, undefined, onUpdate, ctx)
        expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/docs/new')
    })

    test('reports the status of an error page it cannot read', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                new Response('png', {
                    status: 500,
                    statusText: 'Broken',
                    headers: {'content-type': 'image/png'}
                })
            )
        )

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            'Fetch failed: 500 Broken'
        )
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('reports the status of an error page too big for the model', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                new Response('x'.repeat(model.contextWindow * taskShare * 4), {
                    status: 500,
                    statusText: 'Broken',
                    headers: {'content-type': 'text/plain'}
                })
            )
        )

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            'Fetch failed: 500 Broken'
        )
        expect(runSubagent).not.toHaveBeenCalled()
    })

    test('counts non-ascii text as a token per character', async () => {
        const chars = Math.ceil(model.contextWindow * taskShare) + 1
        fetchMock.mockImplementation(() => Promise.resolve(page('日'.repeat(chars))))

        await expect(tool().execute('id', params, undefined, onUpdate, ctx)).rejects.toThrow(
            FetchErrors.PageTooBig
        )
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
