import {describe, expect, test} from 'bun:test'

import {digest, maxBytes} from '../../../src/subagent/fetch/digest'

const response = (body: string | Uint8Array, contentType?: string): Response =>
    new Response(body, {headers: contentType === undefined ? {} : {'content-type': contentType}})

const text = async (page: Response): Promise<string> => (await digest(page)).text
const article = '<p>' + 'word '.repeat(300) + '</p>'
describe('digest', () => {
    test('turns an html article into markdown and drops page chrome', async () => {
        const html = `<html><body><nav>menu</nav><article><h1>Title</h1>${article}</article></body></html>`
        const markdown = await text(response(html, 'text/html; charset=utf-8'))
        expect(markdown).toStartWith('## Title\n\nword word')
        expect(markdown).not.toContain('menu')
    })

    test('falls back to the whole body when readability finds no article', async () => {
        const html = '<html><body><p>hi <b>there</b></p><script>x()</script></body></html>'
        expect(await text(response(html, 'text/html'))).toBe('hi **there**')
    })

    test('reads html fragments and bare text served as html', async () => {
        expect(await text(response('<p>hi</p>', 'text/html'))).toBe('hi')
        expect(await text(response('<body><p>hi</p></body>', 'text/html'))).toBe('hi')
        expect(await text(response('plain', 'text/html'))).toBe('plain')
    })

    test('keeps table rows together', async () => {
        const html =
            '<table><tr><th>item</th><th>price</th></tr><tr><td>a</td><td>5</td></tr></table>'
        expect(await text(response(html, 'text/html'))).toBe(
            '| item | price |\n| --- | --- |\n| a | 5 |'
        )
    })

    test('passes text through', async () => {
        expect(await text(response(' plain \n', 'text/plain'))).toBe('plain')
    })

    test('passes json and xml through', async () => {
        expect(await text(response('{"a":1}', 'application/json'))).toBe('{"a":1}')
        expect(await text(response('{"a":1}', 'application/ld+json'))).toBe('{"a":1}')
        expect(await text(response('<a/>', 'application/xml'))).toBe('<a/>')
        expect(await text(response('<a/>', 'application/rss+xml'))).toBe('<a/>')
    })

    test('treats a missing content type as text', async () => {
        expect(await text(response('llms'))).toBe('llms')
    })

    test('decodes by the header charset', async () => {
        const bytes = new Uint8Array([0xe9])
        expect(await text(response(bytes, 'text/plain; charset="iso-8859-1"'))).toBe('é')
    })

    test('decodes html by its meta charset when the header has none', async () => {
        const bytes = Uint8Array.from('<meta charset="iso-8859-1"><p>\xe9</p>', c =>
            c.charCodeAt(0)
        )
        expect(await text(response(bytes, 'text/html'))).toBe('é')
    })

    test('prefers the header charset over the meta charset', async () => {
        const bytes = new TextEncoder().encode('<meta charset="iso-8859-1"><p>é</p>')
        expect(await text(response(bytes, 'text/html; charset=utf-8'))).toBe('é')
    })

    test('falls back to utf-8 on an unknown charset', async () => {
        const bytes = new TextEncoder().encode('é')
        expect(await text(response(bytes, 'text/plain; charset=bogus'))).toBe('é')
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

    test('leads with the page title', async () => {
        const html = '<html><head><title> Quenlop v7 </title></head><body><p>hi</p></body></html>'
        expect(await text(response(html, 'text/html'))).toBe('Title: Quenlop v7\n\nhi')
    })

    test('keeps the h1 and sidebar of a page readability would not touch', async () => {
        const html =
            '<html><head><title>Manual</title></head><body><h1>Manual</h1>'
            + '<aside><p>Requires: 3.10</p></aside></body></html>'
        expect(await text(response(html, 'text/html'))).toBe(
            'Title: Manual\n\n# Manual\n\nRequires: 3.10'
        )
    })

    test('reads a page whose markup skips the head tag', async () => {
        const html =
            '<!DOCTYPE html><html><meta charset="utf-8"><title>Spec</title><body><p>hi</p></body></html>'
        expect(await text(response(html, 'text/html'))).toBe('Title: Spec\n\nhi')
    })

    test('lifts a title that landed in the body out of the prose', async () => {
        const html = '<TITLE>Old</TITLE><BODY><H1>Web</H1><P>hi</BODY>'
        expect(await text(response(html, 'text/html'))).toBe('Title: Old\n\n# Web\n\nhi')
    })

    test('fences a bare pre block without escaping it', async () => {
        const html = '<pre>&gt;&gt;&gt; a == __b__</pre>'
        expect(await text(response(html, 'text/html'))).toBe('```\n>>> a == __b__\n```')
    })

    test('keeps form method, action and field names', async () => {
        const html =
            '<form method="POST" action="/order"><input name="size"><select name="qty"></select></form>'
        expect(await text(response(html, 'text/html'))).toBe(
            'Form (method=post, action=/order)\n\n[input name="size"][select name="qty"]'
        )
        expect(
            await text(response('<form><textarea name="note"></textarea>Go</form>', 'text/html'))
        ).toBe('Form (method=get, action=)\n\n[textarea name="note"]Go')
        expect(await text(response('<form></form><p>x</p>', 'text/html'))).toBe(
            'Form (method=get, action=)\n\nx'
        )
    })

    test('decodes undeclared latin-1 text as windows-1252', async () => {
        const bytes = Uint8Array.from('caf\xe9', c => c.charCodeAt(0))
        expect(await text(response(bytes, 'text/plain'))).toBe('café')
    })

    test('falls back to windows-1252 when the declared charset is unknown', async () => {
        const bytes = Uint8Array.from('caf\xe9', c => c.charCodeAt(0))
        expect(await text(response(bytes, 'text/plain; charset=nope'))).toBe('café')
    })

    test('passes source and config text types through', async () => {
        expect(await text(response('x=1', 'application/javascript'))).toBe('x=1')
        expect(await text(response('a: 1', 'application/x-yaml'))).toBe('a: 1')
    })

    test('sniffs an octet-stream body that is really text', async () => {
        expect(await text(response('token: 1', 'application/octet-stream'))).toBe('token: 1')
        await expect(
            digest(response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'application/octet-stream'))
        ).rejects.toThrow('unsupported content type application/octet-stream')
        await expect(
            digest(response(new Uint8Array([0x61, 0x00]), 'application/octet-stream'))
        ).rejects.toThrow('unsupported content type application/octet-stream')
    })

    test('reports a meta refresh target as written', async () => {
        const html = '<meta http-equiv="Refresh" content="0; URL=\'/new\'"><p>Redirecting</p>'
        expect(await digest(response(html, 'text/html'))).toEqual({
            text: 'Redirecting',
            refresh: '/new'
        })
        expect(
            await digest(response('<meta http-equiv="refresh" content="5"><p>x</p>', 'text/html'))
        ).toEqual({text: 'x'})
    })

    test('rejects a page with no readable text', async () => {
        const html = '<html><body><script>x()</script></body></html>'
        await expect(digest(response(html, 'text/html'))).rejects.toThrow(
            'Fetch failed: page has no readable text'
        )
    })

    test('reads a page whose meta tag comes before the head', async () => {
        const html =
            '<html><meta charset="utf-8"><head><title>Site</title></head><body><p>hi</p></body></html>'
        expect(await text(response(html, 'text/html'))).toBe('Title: Site\n\nhi')
    })

    test('drops mkdocs line anchors from code', async () => {
        const html =
            '<pre><code><a id="__codelineno-0-1" href="#__codelineno-0-1"></a>pip x\n'
            + '<a id="__codelineno-0-2" href="#__codelineno-0-2"></a>serve</code></pre>'
        expect(await text(response(html, 'text/html'))).toBe('```\npip x\nserve\n```')
    })

    test('keeps code lines marked by tags on their own lines', async () => {
        const page = async (code: string) =>
            text(response(`<pre><code class="language-js">${code}</code></pre>`, 'text/html'))
        const want = '```js\na = 1\nb = 2\n```'
        expect(await page('<div>a = 1</div><div>b = 2</div>')).toBe(want)
        expect(await page('a = 1<br>b = 2')).toBe(want)
        expect(await page('<p>a = 1</p><p>b = 2</p>')).toBe(want)
        expect(await page('<table><tr><td>a = 1</td></tr><tr><td>b = 2</td></tr></table>')).toBe(
            want
        )
        expect(await page('<div><div>a = 1</div></div><div>b = 2</div>')).toBe(want)
        expect(await page('a = 1<div>b = 2</div>')).toBe(want)
        expect(await page('<span class="line">a = 1</span>\n<span class="line">b = 2</span>')).toBe(
            want
        )
    })

    test('keeps image alt and title text', async () => {
        const html = '<p>Diagram:</p><img src="/d.png" alt="port 7788" title="Robert">'
        expect(await text(response(html, 'text/html'))).toBe(
            'Diagram:\n\n![port 7788](/d.png "Robert")'
        )
    })

    test('keeps text hidden by inline style', async () => {
        const html = '<p>a</p><div style="display:none">transcript</div>'
        expect(await text(response(html, 'text/html'))).toBe('a\n\ntranscript')
    })

    test('reads xhtml as html', async () => {
        const html = '<html><body><h1>X</h1><p>hi</p></body></html>'
        expect(await text(response(html, 'application/xhtml+xml'))).toBe('# X\n\nhi')
    })

    test('drops noscript and template content', async () => {
        const html = '<p>a</p><noscript>enable js</noscript><template><p>tpl</p></template>'
        expect(await text(response(html, 'text/html'))).toBe('a')
    })
})
