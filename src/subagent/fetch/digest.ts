import {formatSize} from '@earendil-works/pi-coding-agent'
import {Readability} from '@mozilla/readability'
import {parseHTML} from 'linkedom'
import TurndownService from 'turndown'
import {tables} from 'turndown-plugin-gfm'

import {SubagentErrors} from '../subagent'

enum ContentKind {
    Html,
    Text,
    Unsupported
}

const turndown = new TurndownService({
    codeBlockStyle: 'fenced',
    headingStyle: 'atx',
    bulletListMarker: '-'
}).use(tables)

const mimeOf = (contentType: string): string => contentType.split(';')[0].trim().toLowerCase()

const classify = (contentType: string): ContentKind => {
    const mime = mimeOf(contentType)

    if (mime === 'text/html' || mime === 'application/xhtml+xml') return ContentKind.Html
    if (mime === '' || mime.startsWith('text/')) return ContentKind.Text
    if (mime === 'application/json' || mime.endsWith('+json')) return ContentKind.Text
    if (mime === 'application/xml' || mime.endsWith('+xml')) return ContentKind.Text
    return ContentKind.Unsupported
}

type Charset = ConstructorParameters<typeof TextDecoder>[0]

const headerCharset = /charset=["']?([^;"'\s>]+)/i
const metaCharset = /<meta[^>]+charset=["']?([^;"'\s>]+)/i

const charsetIn = (pattern: RegExp, source: string): Charset | undefined =>
    pattern.exec(source)?.[1] as Charset | undefined

const decode = (bytes: Uint8Array, charset: Charset | undefined): string => {
    try {
        return new TextDecoder(charset).decode(bytes)
    } catch {
        return new TextDecoder().decode(bytes)
    }
}

const decodeBody = (bytes: Uint8Array, contentType: string, kind: ContentKind): string => {
    const charset = charsetIn(headerCharset, contentType)
    const body = decode(bytes, charset)

    if (charset !== undefined || kind !== ContentKind.Html) return body

    const declared = charsetIn(metaCharset, body)
    return declared === undefined ? body : decode(bytes, declared)
}

/** The one field read off the parsed document. Its DOM types are not in this tsconfig lib. */
type ParsedDocument = {body: {innerHTML: string}}

/** linkedom leaves `body` empty unless the markup has both `<html>` and `<body>`. */
const asDocument = (html: string): string =>
    /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html) ?
        html
    :   `<html><body>${html}</body></html>`

const htmlToMarkdown = (html: string): string => {
    const {document} = parseHTML(asDocument(html))
    const article = new Readability(document).parse()
    const content = article?.content ?? (document as unknown as ParsedDocument).body.innerHTML
    return turndown.turndown(content).trim()
}

// MAGIC NUMBER: download cap. Claude Code WebFetch and mcp-fetch both stop at 10 MB.
// It fits large docs pages and most PDFs, and bounds memory before the token check runs.
const maxBytes = 10 * 1024 * 1024

const readBody = async (response: Response): Promise<Uint8Array> => {
    const chunks: Uint8Array[] = []
    let size = 0

    if (response.body === null) return Buffer.concat(chunks)

    const stream: AsyncIterable<Uint8Array> = response.body

    for await (const chunk of stream) {
        size += chunk.byteLength

        if (size > maxBytes)
            throw new Error(SubagentErrors.FetchFailed + `page over ${formatSize(maxBytes)}`)
        chunks.push(chunk)
    }

    return Buffer.concat(chunks)
}

const digest = async (response: Response): Promise<string> => {
    const contentType = response.headers.get('content-type') ?? ''
    const kind = classify(contentType)

    if (kind === ContentKind.Unsupported) {
        await response.body?.cancel()
        throw new Error(SubagentErrors.FetchFailed + `unsupported content type ${contentType}`)
    }

    const body = decodeBody(await readBody(response), contentType, kind)
    const text = kind === ContentKind.Html ? htmlToMarkdown(body) : body.trim()

    if (text === '') throw new Error(SubagentErrors.FetchFailed + 'page has no readable text')
    return text
}

export {digest, maxBytes}
