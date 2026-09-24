import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'

import {browserAgent, ddg, parseResults} from '../../src/search/ddg'
import {endpointOverride} from '../../src/search/engines'

const row = (href: string, title: string, snippet: string, kind = 'result'): string =>
    `<div class="${kind} results_links"><a class="result__a" href="${href}">${title}</a>`
    + `<a class="result__snippet" href="${href}">${snippet}</a></div>`
const page = [
    row(
        '//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.test%2Fmallard&rut=abc',
        'Mallard\n <b>duck</b>',
        'Green  head.'
    ),
    row(
        '//duckduckgo.com/l/?uddg=https%3A%2F%2Fad.test%2F',
        'Buy ducks',
        'Cheap',
        'result result--ad'
    ),
    row('https://direct.test/teal', '', ''),
    row('//duckduckgo.com/l/?rut=abc', 'No destination', 'x'),
    row('http://[bad', 'Broken href', 'x'),
    '<div class="result"><span>no anchor</span></div>'
].join('')
const html = (body: string, status = 200): Response =>
    new Response(`<html><body>${body}</body></html>`, {
        status,
        headers: {'content-type': 'text/html'}
    })
const parsed = [
    {title: 'Mallard duck', url: 'https://a.test/mallard', description: 'Green head.'},
    {title: 'https://direct.test/teal', url: 'https://direct.test/teal', description: ''}
]
const realFetch = globalThis.fetch
const fetchMock = mock((_url: string, _init?: RequestInit) => Promise.resolve(html(page)))
beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockClear()
    fetchMock.mockImplementation(() => Promise.resolve(html(page)))
    delete process.env[endpointOverride]
})

afterAll(() => {
    globalThis.fetch = realFetch
})

describe('parseResults', () => {
    test('unwraps the redirect, skips ads and rows without a destination', () => {
        expect(parseResults(page)).toEqual(parsed)
    })
})

describe('ddg', () => {
    test('gets the html page as a browser and parses it', async () => {
        const signal = new AbortController().signal
        expect(await ddg('what color is a duck', signal)).toEqual(parsed)
        expect(fetchMock).toHaveBeenCalledWith(
            'https://html.duckduckgo.com/html/?q=what+color+is+a+duck',
            {headers: {accept: 'text/html', 'user-agent': browserAgent}, signal}
        )
        expect(browserAgent).toStartWith('Mozilla/5.0')
    })

    test('uses the endpoint override', async () => {
        process.env[endpointOverride] = 'http://127.0.0.1:1/ddg'
        await ddg('q', undefined)
        expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:1/ddg?q=q')
    })

    test('names a bot challenge instead of returning nothing', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(html('<p>anomaly</p>', 202)))
        await expect(ddg('q', undefined)).rejects.toThrow(
            'Search failed: ddg answered a bot challenge instead of results'
        )
    })

    test('names the status when throttled', async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(new Response('', {status: 403, statusText: 'Forbidden'}))
        )
        await expect(ddg('q', undefined)).rejects.toThrow('Search failed: ddg 403 Forbidden')
    })
})
