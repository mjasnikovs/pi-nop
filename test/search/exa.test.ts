import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'

import {endpointOverride} from '../../src/search/engines'
import {exa, parseBlocks} from '../../src/search/exa'

const text = [
    'Title: Mallard | National Geographic',
    'URL: https://a.test/mallard',
    'Published: N/A',
    'Author: N/A',
    'Highlights:',
    'The green head   and yellow bill.',
    '...',
    'The male, or drake, is the more distinctively colored.',
    '',
    '---',
    '',
    'Title: ',
    'URL: https://b.test/teal',
    'Text: A small dabbling duck.',
    '---',
    'Title: No url here',
    'Published: N/A',
    '---',
    'Title: Bare',
    'URL: https://c.test/bare'
].join('\n')
const parsed = [
    {
        title: 'Mallard | National Geographic',
        url: 'https://a.test/mallard',
        description: 'The green head and yellow bill.'
    },
    {
        title: 'https://b.test/teal',
        url: 'https://b.test/teal',
        description: 'A small dabbling duck.'
    },
    {title: 'Bare', url: 'https://c.test/bare', description: ''}
]
const rpc = (result: unknown): string =>
    JSON.stringify({jsonrpc: '2.0', id: 1, ...(result as object)})
const okBody = rpc({result: {content: [{type: 'text', text}]}})
const sse = (body: string): Response =>
    new Response(`event: message\ndata: ${body}\n\n`, {
        headers: {'content-type': 'text/event-stream'}
    })
const realFetch = globalThis.fetch
const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(sse(okBody)))
beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockClear()
    fetchMock.mockImplementation(() => Promise.resolve(sse(okBody)))
    delete process.env[endpointOverride]
})

afterAll(() => {
    globalThis.fetch = realFetch
})

describe('parseBlocks', () => {
    test('reads title, url and the first highlight of every block with a url', () => {
        expect(parseBlocks(text)).toEqual(parsed)
    })
})

describe('exa', () => {
    test('posts the tool call and reads the event stream', async () => {
        const signal = new AbortController().signal
        expect(await exa('what color is a duck', signal)).toEqual(parsed)
        expect(fetchMock).toHaveBeenCalledWith('https://mcp.exa.ai/mcp', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                    name: 'web_search_exa',
                    arguments: {query: 'what color is a duck', numResults: 10}
                }
            }),
            signal
        })
    })

    test('reads a plain json body too', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(new Response(okBody)))
        expect(await exa('q', undefined)).toEqual(parsed)
    })

    test('uses the endpoint override', async () => {
        process.env[endpointOverride] = 'http://127.0.0.1:1/exa'
        await exa('q', undefined)
        expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:1/exa')
    })

    test('raises an rpc error with its message', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(sse(rpc({error: {code: -32000, message: 'rate limited'}})))
        )
        await expect(exa('q', undefined)).rejects.toThrow('Search failed: exa: rate limited')
    })

    test('raises an error result with its text', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                sse(rpc({result: {isError: true, content: [{type: 'text', text: 'bad query'}]}}))
            )
        )
        await expect(exa('q', undefined)).rejects.toThrow('Search failed: exa: bad query')
    })

    test('raises a result without text', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(sse(rpc({result: {content: [{type: 'image'}]}})))
        )
        await expect(exa('q', undefined)).rejects.toThrow('Search failed: exa: no result')
    })

    test('rejects a body in another shape', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(sse(rpc({result: {content: 'x'}}))))
        await expect(exa('q', undefined)).rejects.toThrow()
    })
})
