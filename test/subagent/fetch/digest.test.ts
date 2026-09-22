import {describe, expect, test} from 'bun:test'

import {digest, maxBytes} from '../../../src/subagent/fetch/digest'

const response = (body: string | Uint8Array, contentType?: string): Response =>
    new Response(body, {headers: contentType === undefined ? {} : {'content-type': contentType}})

const article = '<p>' + 'word '.repeat(300) + '</p>'
describe('digest', () => {
    test('turns an html article into markdown and drops page chrome', async () => {
        const html = `<html><body><nav>menu</nav><article><h1>Title</h1>${article}</article></body></html>`
        const text = await digest(response(html, 'text/html; charset=utf-8'))
        expect(text).toStartWith('## Title\n\nword word')
        expect(text).not.toContain('menu')
    })

    test('falls back to the whole body when readability finds no article', async () => {
        const html = '<html><body><p>hi <b>there</b></p><script>x()</script></body></html>'
        expect(await digest(response(html, 'text/html'))).toBe('hi **there**')
    })

    test('reads html fragments and bare text served as html', async () => {
        expect(await digest(response('<p>hi</p>', 'text/html'))).toBe('hi')
        expect(await digest(response('<body><p>hi</p></body>', 'text/html'))).toBe('hi')
        expect(await digest(response('plain', 'text/html'))).toBe('plain')
    })

    test('keeps table rows together', async () => {
        const html =
            '<table><tr><th>item</th><th>price</th></tr><tr><td>a</td><td>5</td></tr></table>'
        expect(await digest(response(html, 'text/html'))).toBe(
            '| item | price |\n| --- | --- |\n| a | 5 |'
        )
    })

    test('passes text through', async () => {
        expect(await digest(response(' plain \n', 'text/plain'))).toBe('plain')
    })

    test('passes json and xml through', async () => {
        expect(await digest(response('{"a":1}', 'application/json'))).toBe('{"a":1}')
        expect(await digest(response('{"a":1}', 'application/ld+json'))).toBe('{"a":1}')
        expect(await digest(response('<a/>', 'application/xml'))).toBe('<a/>')
        expect(await digest(response('<a/>', 'application/rss+xml'))).toBe('<a/>')
    })

    test('treats a missing content type as text', async () => {
        expect(await digest(response('llms'))).toBe('llms')
    })

    test('decodes by the header charset', async () => {
        const bytes = new Uint8Array([0xe9])
        expect(await digest(response(bytes, 'text/plain; charset="iso-8859-1"'))).toBe('é')
    })

    test('decodes html by its meta charset when the header has none', async () => {
        const bytes = Uint8Array.from('<meta charset="iso-8859-1"><p>\xe9</p>', c =>
            c.charCodeAt(0)
        )
        expect(await digest(response(bytes, 'text/html'))).toBe('é')
    })

    test('prefers the header charset over the meta charset', async () => {
        const bytes = new TextEncoder().encode('<meta charset="iso-8859-1"><p>é</p>')
        expect(await digest(response(bytes, 'text/html; charset=utf-8'))).toBe('é')
    })

    test('falls back to utf-8 on an unknown charset', async () => {
        const bytes = new TextEncoder().encode('é')
        expect(await digest(response(bytes, 'text/plain; charset=bogus'))).toBe('é')
    })

    test('rejects unsupported content types and closes the body', async () => {
        const unsupported = response('png bytes', 'image/png')
        await expect(digest(unsupported)).rejects.toThrow(
            'Fetch failed: unsupported content type image/png'
        )
        expect(unsupported.bodyUsed).toBe(true)
    })

    test('stops reading past the download cap', async () => {
        const big = response(new Uint8Array(maxBytes + 1), 'text/plain')
        await expect(digest(big)).rejects.toThrow('Fetch failed: page over 10.0MB')
    })

    test('rejects an empty body', async () => {
        await expect(digest(new Response(null))).rejects.toThrow(
            'Fetch failed: page has no readable text'
        )
    })

    test('rejects a page with no readable text', async () => {
        const html = '<html><body><script>x()</script></body></html>'
        await expect(digest(response(html, 'text/html'))).rejects.toThrow(
            'Fetch failed: page has no readable text'
        )
    })
})
