import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import type {ExtensionAPI, ExtensionContext, ToolDefinition} from '@earendil-works/pi-coding-agent'
import type {TObject, TString} from 'typebox'
import type {NopConfig} from '../../src/config/config'

type SearchTool = ToolDefinition<TObject<{query: TString}>>

let config: NopConfig = {}
const safeConfig = mock((_ctx: ExtensionContext) => config)
const {SubagentErrors} = await import('../../src/subagent/subagent')
await mock.module('../../src/subagent/subagent', () => ({safeConfig, SubagentErrors}))

const {braveKey} = await import('../../src/search/brave')
const {endpointOverride} = await import('../../src/search/engines')
const {engineOverride, formatResults, default: register} = await import('../../src/search/search')

const results = {
    web: {
        results: [
            {title: 'Mallard', url: 'https://a.test/mallard', description: 'Green head.'},
            {title: 'Bad', url: 'ftp://x.test/', description: 'dropped'},
            {title: 'Teal', url: 'https://b.test/teal'}
        ]
    }
}
const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}})
const realFetch = globalThis.fetch
const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(json(results)))
const registerTool = mock((_tool: SearchTool) => undefined)
const pi = {registerTool} as unknown as ExtensionAPI
const ctx = {cwd: '/cwd'} as unknown as ExtensionContext

const tool = (): SearchTool => {
    register(pi)
    return registerTool.mock.calls[0][0]
}

const run = (query = 'duck') => tool().execute('id', {query}, undefined, undefined, ctx)
beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockClear()
    fetchMock.mockImplementation(() => Promise.resolve(json(results)))
    registerTool.mockClear()
    safeConfig.mockClear()
    config = {}
    process.env[braveKey] = 'secret'
    delete process.env[engineOverride]
    delete process.env[endpointOverride]
})

afterAll(() => {
    globalThis.fetch = realFetch
    delete process.env[braveKey]
    delete process.env[engineOverride]
    mock.restore()
})

describe('formatResults', () => {
    test('numbers the results as markdown links with the snippet after a dash', () => {
        expect(
            formatResults('q', [
                {title: 'Mallard', url: 'https://a.test/mallard', description: 'Green head.'},
                {title: 'Teal', url: 'https://b.test/teal', description: ''}
            ])
        ).toBe('1. [Mallard](https://a.test/mallard) — Green head.\n2. [Teal](https://b.test/teal)')
    })

    test('says so when there is nothing', () => {
        expect(formatResults('what color is a duck', [])).toBe(
            'No results for: what color is a duck'
        )
    })
})

describe('web-search tool', () => {
    test('registers under the name web-search with a query parameter', () => {
        const {name, parameters} = tool()
        expect(name).toBe('web-search')
        expect(Object.keys(parameters.properties)).toEqual(['query'])
    })

    test('searches with the configured engine and lists fetchable results', async () => {
        config = {'web-search': {engine: 'brave'}}
        expect(await run()).toEqual({
            content: [
                {
                    type: 'text',
                    text: '1. [Mallard](https://a.test/mallard) — Green head.\n2. [Teal](https://b.test/teal)'
                }
            ],
            details: {engine: 'brave', results: 2}
        })
        expect(safeConfig).toHaveBeenCalledWith(ctx)
        expect(fetchMock.mock.calls[0][0]).toStartWith('https://api.search.brave.com/')
    })

    test('defaults to exa', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                new Response(JSON.stringify({result: {content: [{type: 'text', text: ''}]}}))
            )
        )
        expect(await run('nothing here')).toEqual({
            content: [{type: 'text', text: 'No results for: nothing here'}],
            details: {engine: 'exa', results: 0}
        })
        expect(fetchMock.mock.calls[0][0]).toBe('https://mcp.exa.ai/mcp')
    })

    test('the engine override wins over the config', async () => {
        config = {'web-search': {engine: 'exa'}}
        process.env[engineOverride] = 'ddg'
        fetchMock.mockImplementation(() =>
            Promise.resolve(new Response('<html></html>', {headers: {'content-type': 'text/html'}}))
        )
        await run()
        expect(fetchMock.mock.calls[0][0]).toStartWith('https://html.duckduckgo.com/')
    })

    test('rejects an unknown engine override before searching', async () => {
        process.env[engineOverride] = 'bing'
        await expect(run()).rejects.toThrow()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('passes an engine failure through', async () => {
        config = {'web-search': {engine: 'brave'}}
        delete process.env[braveKey]
        await expect(run()).rejects.toThrow('Search failed: BRAVE_SEARCH_API_KEY is not set')
    })
})
