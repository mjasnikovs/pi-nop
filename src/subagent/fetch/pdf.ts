import {fileURLToPath} from 'node:url'

import {getResolvedPDFJS} from 'unpdf'
import type {PDFPageProxy} from 'unpdf/pdfjs'

import {normalize} from '../answer'
import type {Source} from '../answer'
import {describe} from '../describe'
import {FetchErrors} from './errors'

type TextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>

// pdf.js wants a trailing slash, and on Windows fileURLToPath ends a folder in a backslash.
const cMapUrl = fileURLToPath(new URL('cmaps', import.meta.url)) + '/'
// pdf.js runs on microtasks only, so without this a long read freezes pi and an abort never lands.
const nextTurn = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

const readFailure = (error: unknown): Error =>
    error instanceof Error && error.name === 'PasswordException' ?
        new Error(FetchErrors.Locked, {cause: error})
    :   new Error(FetchErrors.Failed + describe(error), {cause: error})

const fromPdfjs = <T>(work: Promise<T>): Promise<T> =>
    work.catch((error: unknown) => {
        throw readFailure(error)
    })

const chunkText = ({items}: TextContent): string =>
    items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('')

const pageText = async (
    page: PDFPageProxy,
    allowance: number,
    signal?: AbortSignal
): Promise<string> => {
    const reader = page.streamTextContent().getReader()
    let text = ''

    try {
        for (
            let chunk = await fromPdfjs(reader.read());
            !chunk.done;
            chunk = await fromPdfjs(reader.read())
        ) {
            const part = chunkText(chunk.value as TextContent)
            allowance -= Buffer.byteLength(part)

            if (allowance < 0) throw new Error(FetchErrors.PageTooBig)
            text += part
            await nextTurn()
            signal?.throwIfAborted()
        }
    } finally {
        // With a full stream queue, the document's destroy() never settles.
        await reader.cancel(new Error('PDF read stopped'))
    }

    return text
}

const pdfText = async (
    bytes: Uint8Array,
    maxBuffer: number,
    signal?: AbortSignal
): Promise<string> => {
    signal?.throwIfAborted()
    const {getDocument} = await getResolvedPDFJS()
    // A copy, since pdf.js refuses a Buffer and detaches the buffer it is given.
    const task = getDocument({data: new Uint8Array(bytes), verbosity: 0, cMapUrl, cMapPacked: true})
    const pages: string[] = []
    let size = 0

    try {
        const pdf = await fromPdfjs(task.promise)

        for (let number = 1; number <= pdf.numPages; number++) {
            const page = await pageText(
                await fromPdfjs(pdf.getPage(number)),
                maxBuffer - size,
                signal
            )
            size += Buffer.byteLength(page)
            pages.push(page)
        }
    } finally {
        await task.destroy()
    }

    const text = pages.join('\n\n').trim()

    if (text === '') throw new Error(FetchErrors.NoTextLayer)
    return text
}

// Between letters a split may be a compound or a split word, so a quote may drop that hyphen.
const wordMark = '\0'
const codeMark = '\u0001'
// U+2010 is the hyphen a browser prints. \p{M} lets a word end in a Hindi vowel sign.
const wordSplits = /(?<=[\p{L}\p{M}])[-\u2010]\n+(?=\p{L})/gu
const codeSplits = /(?<=[\p{L}\p{M}\p{N}])[-\u2010]\n+(?=[\p{L}\p{N}])/gu
const hyphens = /[-\u2010] ?|[^]/gu
// Not RegExp.escape: it needs Node 24, and pi supports Node 22.
const literal = (char: string): string => `\\u{${char.codePointAt(0)?.toString(16)}}`

// A quote that copies the line break as a space has `- ` where the split was.
const token = (part: string): string => {
    const [first = '', space] = [...part]
    if (space !== undefined) return `(?:${literal(first)} |${wordMark}|${codeMark})`
    if (first === '-' || first === '\u2010') return `[${literal(first)}${wordMark}${codeMark}]`
    return `${wordMark}?${literal(first)}`
}

// The marks sit only between letters or digits, so the pattern needs no such check of its own.
const quotePattern = (prose: string): RegExp =>
    new RegExp((prose.match(hyphens) ?? []).map(token).join(''), 'u')

const quotable = (text: string): Source => {
    const flat = normalize(text.replace(wordSplits, wordMark).replace(codeSplits, codeMark))
    return {holds: prose => quotePattern(prose).test(flat)}
}

export {pdfText, quotable}
