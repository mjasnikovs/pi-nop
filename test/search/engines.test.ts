import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'

import {
    endpoint,
    endpointOverride,
    httpOnly,
    request,
    resultCount,
    SearchErrors,
    squash
} from '../../src/search/engines'

const realFetch = globalThis.fetch
const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(new Response('ok')))
beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockClear()
    fetchMock.mockImplementation(() => Promise.resolve(new Response('ok')))
    delete process.env[endpointOverride]
})

afterAll(() => {
    globalThis.fetch = realFetch
    delete process.env[endpointOverride]
})

describe('endpoint', () => {
    test('is the engine url unless the override is set', () => {
        expect(endpoint('https://engine.test/')).toBe('https://engine.test/')
        process.env[endpointOverride] = 'http://127.0.0.1:1/fake'
        expect(endpoint('https://engine.test/')).toBe('http://127.0.0.1:1/fake')
    })

    test('asks for ten results', () => {
        expect(resultCount).toBe(10)
    })
})

describe('request', () => {
    test('sends the init with the signal and returns the status and body', async () => {
        const signal = new AbortController().signal
        const reply = await request('x', 'https://engine.test/', {method: 'POST'}, signal)
        expect(fetchMock).toHaveBeenCalledWith('https://engine.test/', {method: 'POST', signal})
        expect(reply).toEqual({status: 200, text: 'ok'})
    })

    test('reports a cancel while the body streams as an abort', async () => {
        const controller = new AbortController()
        const body = new ReadableStream({
            pull: () => {
                controller.abort()
                return Promise.reject(new DOMException('aborted', 'AbortError'))
            }
        })
        fetchMock.mockImplementation(() => Promise.resolve(new Response(body)))

        await expect(request('x', 'https://engine.test/', {}, controller.signal)).rejects.toThrow(
            SearchErrors.Aborted
        )
    })

    test('reports a body that breaks off as a failure', async () => {
        const body = new ReadableStream({
            pull: () => Promise.reject(new Error('socket hang up'))
        })
        fetchMock.mockImplementation(() => Promise.resolve(new Response(body)))

        await expect(request('x', 'https://engine.test/', {}, undefined)).rejects.toThrow(
            'Search failed: socket hang up'
        )
    })

    test('names the engine and the status on a non-ok response', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                new Response('', {
                    status: 429,
                    statusText: 'Too Many',
                    headers: {'retry-after': '9'}
                })
            )
        )

        await expect(request('x', 'https://engine.test/', {}, undefined)).rejects.toThrow(
            'Search failed: x 429 Too Many, Retry-After: 9'
        )
    })

    test('surfaces the cause when fetch itself fails', async () => {
        const cause = new Error('getaddrinfo ENOTFOUND')
        fetchMock.mockImplementation(() => Promise.reject(new TypeError('fetch failed', {cause})))

        await expect(request('x', 'https://engine.test/', {}, undefined)).rejects.toThrow(
            'Search failed: fetch failed: getaddrinfo ENOTFOUND'
        )
    })

    test('reports a cancel as an abort', async () => {
        const controller = new AbortController()
        fetchMock.mockImplementation(() => {
            controller.abort()
            return Promise.reject(new DOMException('aborted', 'AbortError'))
        })

        await expect(request('x', 'https://engine.test/', {}, controller.signal)).rejects.toThrow(
            SearchErrors.Aborted
        )
    })
})

describe('httpOnly', () => {
    test('keeps http and https results only', () => {
        const keep = [
            {title: 'a', url: 'https://a.test/x', description: ''},
            {title: 'b', url: 'http://b.test/', description: ''}
        ]
        expect(
            httpOnly([
                ...keep,
                {title: 'c', url: 'ftp://c.test/', description: ''},
                {title: 'd', url: 'not a url', description: ''},
                {title: 'e', url: 'javascript:alert(1)', description: ''}
            ])
        ).toEqual(keep)
    })
})

describe('squash', () => {
    test('flattens whitespace', () => {
        expect(squash('  a \n\t b  ')).toBe('a b')
    })
})
