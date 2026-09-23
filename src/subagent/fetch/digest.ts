import {formatSize} from '@earendil-works/pi-coding-agent'
import {isProbablyReaderable, Readability} from '@mozilla/readability'
import {parseHTML} from 'linkedom'
import TurndownService from 'turndown'
import {tables} from 'turndown-plugin-gfm'

import {SubagentErrors} from '../subagent'

enum ContentKind {
    Html,
    Text,
    Sniff,
    Unsupported
}

/** The fields read off a turndown node. Its DOM types are not in this tsconfig lib. */
type RuleNode = {
    nodeName: string
    textContent: string | null
    firstChild: {nodeName: string} | null
    getAttribute(name: string): string | null
}

const fields = new Set(['INPUT', 'SELECT', 'TEXTAREA'])
const isField = (node: RuleNode): boolean => fields.has(node.nodeName)
const field = (node: RuleNode): string =>
    `[${node.nodeName.toLowerCase()} name="${node.getAttribute('name') ?? ''}"]`

const formLine = (node: RuleNode): string => {
    const method = (node.getAttribute('method') ?? 'get').toLowerCase()
    return `Form (method=${method}, action=${node.getAttribute('action') ?? ''})`
}

const blank = (node: RuleNode): string => {
    if (isField(node)) return field(node)
    return node.nodeName === 'FORM' ? `\n\n${formLine(node)}\n\n` : ''
}

const turndown = new TurndownService({
    codeBlockStyle: 'fenced',
    headingStyle: 'atx',
    bulletListMarker: '-',
    // Turndown drops empty elements before rules run, and fields are usually empty.
    blankReplacement: (_content, node: RuleNode) => blank(node)
}).use(tables)
turndown.remove(['script', 'style', 'noscript', 'template'])
// Turndown only fences <pre><code>; a bare <pre> would be escaped as prose.
turndown.addRule('barePre', {
    filter: (node: RuleNode) => node.nodeName === 'PRE' && node.firstChild?.nodeName !== 'CODE',
    replacement: (_content, node: RuleNode) => `\n\n\`\`\`\n${node.textContent ?? ''}\n\`\`\`\n\n`
})

turndown.addRule('form', {
    filter: 'form',
    replacement: (content, node: RuleNode) => `\n\n${formLine(node)}\n\n${content}\n\n`
})

turndown.addRule('field', {
    filter: (node: RuleNode) => isField(node),
    replacement: (_content, node: RuleNode) => field(node)
})

const textMimes = new Set([
    'application/json',
    'application/xml',
    'application/javascript',
    'application/x-javascript',
    'application/ecmascript',
    'application/yaml',
    'application/x-yaml',
    'application/toml',
    'application/x-sh',
    'application/x-ndjson',
    'application/sql'
])

const mimeOf = (contentType: string): string => contentType.split(';')[0].trim().toLowerCase()

const classify = (contentType: string): ContentKind => {
    const mime = mimeOf(contentType)

    if (mime === 'text/html' || mime === 'application/xhtml+xml') return ContentKind.Html
    if (mime === '' || mime.startsWith('text/')) return ContentKind.Text
    if (mime.endsWith('+json') || mime.endsWith('+xml')) return ContentKind.Text
    if (textMimes.has(mime)) return ContentKind.Text
    if (mime === 'application/octet-stream') return ContentKind.Sniff
    return ContentKind.Unsupported
}

type Charset = ConstructorParameters<typeof TextDecoder>[0]

const headerCharset = /charset=["']?([^;"'\s>]+)/i
const metaCharset = /<meta[^>]+charset=["']?([^;"'\s>]+)/i

const charsetIn = (pattern: RegExp, source: string): Charset | undefined =>
    pattern.exec(source)?.[1] as Charset | undefined

const utf8 = (bytes: Uint8Array): string | undefined => {
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes)
    } catch {
        return undefined
    }
}

// Undeclared non-UTF-8 text is nearly always Latin-1, which windows-1252 covers.
const decodeUndeclared = (bytes: Uint8Array): string =>
    utf8(bytes) ?? new TextDecoder('windows-1252').decode(bytes)

const decode = (bytes: Uint8Array, charset: Charset | undefined): string => {
    if (charset === undefined) return decodeUndeclared(bytes)

    try {
        return new TextDecoder(charset).decode(bytes)
    } catch {
        return decodeUndeclared(bytes)
    }
}

const decodeBody = (bytes: Uint8Array, contentType: string, kind: ContentKind): string => {
    const charset = charsetIn(headerCharset, contentType)
    const body = decode(bytes, charset)

    if (charset !== undefined || kind !== ContentKind.Html) return body

    const declared = charsetIn(metaCharset, body)
    return declared === undefined ? body : decode(bytes, declared)
}

const looksLikeText = (bytes: Uint8Array): boolean =>
    !bytes.includes(0) && utf8(bytes) !== undefined

/** The fields read off the parsed document. Its DOM types are not in this tsconfig lib. */
type ParsedElement = {
    textContent: string
    remove(): void
    getAttribute(name: string): string | null
}
type ParsedNode = {querySelectorAll(selector: string): ParsedElement[]}
type ParsedDocument = ParsedNode & {
    title: string
    body: ParsedElement & ParsedNode & {innerHTML: string}
}

const parse = (html: string): ParsedDocument => {
    const {document} = parseHTML(html)
    return document as unknown as ParsedDocument
}

const structureTags = /<\/?(html|head|body)[^>]*>/gi
const wrap = (html: string): string => `<html><body>${html}</body></html>`

// linkedom leaves `body` empty unless <html>, <head> and <body> appear in textbook order,
// so anything else is flattened and wrapped again.
const parseLenient = (html: string): ParsedDocument => {
    const framed = /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html)
    const document = parse(framed ? html : wrap(html))

    if (document.body.textContent.trim() !== '') return document
    return parse(wrap(html.replace(structureTags, '')))
}

// A <title> outside <head> lands in the body, where it would read as prose.
const takeTitle = (document: ParsedDocument): string => {
    const stray = document.body.querySelectorAll('title')
    const title = document.title || (stray[0]?.textContent ?? '')

    for (const node of stray) node.remove()
    return title.trim()
}

const refreshUrl = /url\s*=\s*["']?([^"']+)/i

const refreshTarget = (document: ParsedDocument): string | undefined => {
    const meta = document
        .querySelectorAll('meta')
        .find(node => node.getAttribute('http-equiv')?.toLowerCase() === 'refresh')
    return refreshUrl.exec(meta?.getAttribute('content') ?? '')?.[1].trim()
}

const mainContent = (document: ParsedDocument): string => {
    if (!isProbablyReaderable(document as never)) return document.body.innerHTML
    return new Readability(document as never).parse()?.content ?? document.body.innerHTML
}

type Digest = {
    text: string
    /** Where a meta refresh sends the reader, as written in the page. */
    refresh?: string
}

const htmlToMarkdown = (html: string): Digest => {
    const document = parseLenient(html)
    const refresh = refreshTarget(document)
    const title = takeTitle(document)
    const markdown = turndown.turndown(mainContent(document)).trim()
    const text = [title === '' ? '' : `Title: ${title}`, markdown]
        .filter(part => part !== '')
        .join('\n\n')

    return refresh === undefined ? {text} : {text, refresh}
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

const unsupported = (contentType: string): Error =>
    new Error(SubagentErrors.FetchFailed + `unsupported content type ${contentType}`)

const digest = async (response: Response): Promise<Digest> => {
    const contentType = response.headers.get('content-type') ?? ''
    const kind = classify(contentType)

    if (kind === ContentKind.Unsupported) {
        await response.body?.cancel()
        throw unsupported(contentType)
    }

    const bytes = await readBody(response)

    if (kind === ContentKind.Sniff && !looksLikeText(bytes)) throw unsupported(contentType)

    const body = decodeBody(bytes, contentType, kind)
    const page = kind === ContentKind.Html ? htmlToMarkdown(body) : {text: body.trim()}

    if (page.text === '') throw new Error(SubagentErrors.FetchFailed + 'page has no readable text')
    return page
}

export {digest, maxBytes}
export type {Digest}
