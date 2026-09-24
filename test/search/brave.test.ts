import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'

import {brave, braveKey} from '../../src/search/brave'
import {endpointOverride} from '../../src/search/engines'

const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}})
const results = {
    web: {
        results: [
            {
                title: 'Mallard',
                url: 'https://a.test/mallard',
                description: 'Green <strong>head</strong> &amp; brown'
            },
            {title: 'Teal', url: 'https://b.test/teal', extra: 1}
        ]
    }
}
const realFetch = globalThis.fetch
const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(json(results)))
beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockClear()
    fetchMock.mockImplementation(() => Promise.resolve(json(results)))
    process.env[braveKey] = 'secret'
    delete process.env[endpointOverride]
})

afterAll(() => {
    globalThis.fetch = realFetch
    delete process.env[braveKey]
})

describe('brave', () => {
    test('sends the query, the count and the key, and reads the results as plain text', async () => {
        const signal = new AbortController().signal
        expect(await brave('what color is a duck', signal)).toEqual([
            {title: 'Mallard', url: 'https://a.test/mallard', description: 'Green head & brown'},
            {title: 'Teal', url: 'https://b.test/teal', description: ''}
        ])
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.search.brave.com/res/v1/web/search?q=what+color+is+a+duck&count=10',
            {headers: {accept: 'application/json', 'x-subscription-token': 'secret'}, signal}
        )
    })

    test('uses the endpoint override', async () => {
        process.env[endpointOverride] = 'http://127.0.0.1:1/brave'
        await brave('q', undefined)
        expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:1/brave?q=q&count=10')
    })

    test('refuses to run without the key', async () => {
        for (const key of [undefined, '']) {
            if (key === undefined) delete process.env[braveKey]
            else process.env[braveKey] = key

            await expect(brave('q', undefined)).rejects.toThrow(
                'Search failed: BRAVE_SEARCH_API_KEY is not set'
            )
        }

        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('reads no web section as no results', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(json({query: {}})))
        expect(await brave('q', undefined)).toEqual([])
    })

    test('rejects a body in another shape', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(json({web: {results: [{title: 1}]}})))
        await expect(brave('q', undefined)).rejects.toThrow()
    })

    test('names the status when the key is rejected', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(new Response('', {status: 401, statusText: 'Unauthorized'}))
        )
        await expect(brave('q', undefined)).rejects.toThrow('Search failed: brave 401 Unauthorized')
    })
})
