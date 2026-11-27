import {spawn} from 'node:child_process'

import {normalize} from '../answer'
import type {Source} from '../answer'
import {createLineReader} from '../guards/lines'
import {onPath} from '../platform'
import {FetchErrors} from './errors'

// `soft` keeps a hyphen that ends a line: the default joins `VX-` / `4471` into `VX4471`.
// pdftotext on Windows ends lines with \r\n, which the split patterns would miss.
const args = ['-remove-hyphens', 'soft', '-eol', 'unix', '-', '-']

const startFailure = (error: Error & {code?: string}): Error =>
    error.code === 'ENOENT' ?
        new Error(FetchErrors.NoPdfReader, {cause: error})
    :   new Error(FetchErrors.Failed + error.message, {cause: error})

const exitFailure = (
    usage: boolean,
    said: string,
    code: number | null,
    signal: string | null
): Error => {
    if (usage) return new Error(FetchErrors.OldPdfReader)
    // A crash ends mid-run, so the last line is only a warning.
    if (signal !== null) return new Error(FetchErrors.Failed + `pdftotext stopped on ${signal}`)
    if (said.endsWith('Incorrect password')) return new Error(FetchErrors.Locked)
    return new Error(FetchErrors.Failed + (said || `pdftotext exited with ${code}`))
}

// Not execFile: its maxBuffer caps stderr too, and a damaged PDF can warn past the page cap.
const convert = (bytes: Uint8Array, maxBuffer: number, signal?: AbortSignal): Promise<string> =>
    new Promise<string>((resolve, reject) => {
        // A plain spawn runs only an .exe or .com; a .cmd needs cmd.exe.
        const child = spawn(onPath('pdftotext', '.EXE;.COM'), args, {signal})
        const chunks: Buffer[] = []
        const lines = createLineReader()
        let size = 0
        let said = ''
        // Usage text answers a bad command line. With these fixed options only an old pdftotext prints it.
        let usage = false

        const hear = (text: string) => {
            for (const line of lines.take(text)) {
                usage ||= line.startsWith('Usage:')
                said = line
            }
        }
        child.stdout.on('data', (chunk: Buffer) => {
            size += chunk.byteLength
            chunks.push(chunk)

            if (size <= maxBuffer) return
            child.kill()
            reject(new Error(FetchErrors.PageTooBig))
        })
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', hear)
        child.on('error', reject)
        child.on('close', (code, killedBy) => {
            if (code === 0) return resolve(Buffer.concat(chunks).toString())
            hear('\n')
            reject(exitFailure(usage, said, code, killedBy))
        })
        // A child that exits or is aborted before reading its input closes stdin; the EPIPE kills pi.
        child.stdin.on('error', () => undefined)
        child.stdin.end(bytes)
    }).catch((error: Error & {code?: string}) => {
        // Our own failures carry no code; a failed spawn, or onPath finding nothing, does.
        throw error.code === undefined ? error : startFailure(error)
    })

const pageBreak = '\f'
const softHyphen = '\u00AD'
// Only the Latin ligatures: full NFKC also turns m² into m2.
const foldLigatures = (text: string): string =>
    text.replace(/[\uFB00-\uFB06]/g, ligature => ligature.normalize('NFKC'))

const clean = (text: string): string =>
    foldLigatures(text.replaceAll(pageBreak, '').replaceAll(softHyphen, '')).trim()

const pdfText = async (
    bytes: Uint8Array,
    maxBuffer: number,
    signal?: AbortSignal
): Promise<string> => {
    const text = clean(await convert(bytes, maxBuffer, signal))

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
