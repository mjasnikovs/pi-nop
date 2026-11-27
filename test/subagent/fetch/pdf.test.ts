import {readFileSync} from 'node:fs'
import {describe, expect, spyOn, test} from 'bun:test'

import {missingFrom} from '../../../src/subagent/answer'
import {FetchErrors} from '../../../src/subagent/fetch/errors'
import {pdfText, quotable} from '../../../src/subagent/fetch/pdf'

const fixture = (name: string): Uint8Array =>
    readFileSync(new URL(`fixtures/${name}.pdf`, import.meta.url))
const limit = 10 * 1024 * 1024
const read = (name: string): Promise<string> => pdfText(fixture(name), limit)
describe('pdfText', () => {
    test('reads every page, a blank line between them', async () => {
        expect(await read('two-pages')).toBe('First page text\n\nSecond page text')
    })

    test('reports a PDF with no text layer', async () => {
        await expect(read('blank')).rejects.toThrow('Fetch failed: PDF has no text layer')
    })

    test('reports what pdf.js said about a broken file', async () => {
        await expect(pdfText(new TextEncoder().encode('%PDF-1.4\njunk'), limit)).rejects.toThrow(
            new Error('Fetch failed: Invalid PDF structure.')
        )
    })

    // A blank PDF has no text to check the signal between, so only the check before reading catches it.
    test('an aborted signal rejects before reading', async () => {
        await expect(pdfText(fixture('blank'), limit, AbortSignal.abort())).rejects.toMatchObject({
            name: 'AbortError'
        })
    })

    test('an abort during a read stops it as aborted, not as too big', async () => {
        const controller = new AbortController()
        setImmediate(() => controller.abort())
        await expect(pdfText(fixture('expands'), limit, controller.signal)).rejects.toMatchObject({
            name: 'AbortError'
        })
    })

    test('stops at the size limit on a PDF that expands past it', async () => {
        await expect(read('expands')).rejects.toThrow(FetchErrors.PageTooBig)
    })

    test('stops inside a page whose text outgrows the size limit', async () => {
        await expect(pdfText(fixture('one-page-bomb'), 100_000)).rejects.toThrow(
            FetchErrors.PageTooBig
        )
    })

    test('reads a damaged PDF without printing its warnings', async () => {
        const warn = spyOn(console, 'warn')
        const info = spyOn(console, 'info')
        const log = spyOn(console, 'log')

        try {
            expect(await read('noisy')).toBe('Fit only the filter')
            expect([warn, info, log].map(spy => spy.mock.calls.length)).toEqual([0, 0, 0])
        } finally {
            warn.mockRestore()
            info.mockRestore()
            log.mockRestore()
        }
    })

    test('names a password protected PDF', async () => {
        await expect(read('locked')).rejects.toThrow(
            new Error('Fetch failed: PDF is password protected')
        )
    })

    test('reads Japanese text in a font the PDF does not embed', async () => {
        expect(await read('sjis-noembed')).toBe('あいうえお')
    })

    test('spells a ligature as plain letters and leaves other symbols alone', async () => {
        expect(await read('ligature')).toBe('configure the pump\narea 5 m²')
    })

    // pdf.js drops a soft hyphen before it hands out the text, so a line-end split stays split.
    test('drops a soft hyphen, joining it only inside a line', async () => {
        expect(await read('soft-hyphen')).toBe('several im\nportant points\none important line')
    })

    test('lets a quote join a word split across a page break', async () => {
        const page = await read('page-split')
        expect(missingFrom(['the fuel system with'], [quotable(page)])).toEqual([])
        expect(missingFrom(['number VX-4471'], [quotable('number VX-\n\n4471')])).toEqual([])
    })

    test('keeps a hyphen that ends a line', async () => {
        expect(await read('split-code')).toStartWith(
            'Fit only the approved replacement filter, part number VX-\n4471.'
        )
    })

    test('leaves the caller its bytes', async () => {
        const bytes = fixture('two-pages')
        await pdfText(bytes, limit)
        expect(bytes.byteLength).toBeGreaterThan(0)
    })
})

describe('quotable', () => {
    const passes = (page: string, quote: string): boolean =>
        missingFrom([quote], [quotable(page)]).length === 0
    test('lets a quote rejoin a code or a word split at a line end', () => {
        expect(passes('part number VX-\n4471.', 'part number VX-4471.')).toBe(true)
        expect(passes('the fuel sys-\ntem with', 'the fuel system with')).toBe(true)
        expect(
            passes(
                'number VX-\n4471. Bleed the fuel sys-\ntem',
                'number VX-4471. Bleed the fuel system'
            )
        ).toBe(true)
    })

    test('lets one quote keep a compound hyphen and drop a split word hyphen', () => {
        const page = 'a well-\nknown fuel sys-\ntem'
        expect(passes(page, 'a well-known fuel system')).toBe(true)
        expect(passes(page, 'a wellknown fuel sys-tem')).toBe(true)
        expect(passes(page, 'a well known fuel system')).toBe(false)
        expect(passes('a well-known fuel', 'a wellknown fuel')).toBe(false)
        expect(passes('the system', 'the sys-tem')).toBe(false)
    })

    test('lets one quote copy a split as a hyphen and a space and rejoin another', () => {
        const page = 'the low-\npressure fuel sys-\ntem, part VX-\n4471'
        expect(passes(page, 'the low- pressure fuel system, part VX-4471')).toBe(true)
        expect(passes(page, 'the low-pressure fuel sys- tem, part VX- 4471')).toBe(true)
        expect(passes(page, 'the low-pressure fuel system, part VX 4471')).toBe(false)
        expect(passes('the low- pressure', 'the low-pressure')).toBe(false)
        expect(passes('the low-pressure', 'the low- pressure')).toBe(false)
    })

    test('reads a U+2010 hyphen at a line end as a split', () => {
        const page = 'the low\u2010\npressure fuel sys\u2010\ntem'
        expect(passes(page, 'the low\u2010pressure fuel system')).toBe(true)
        expect(passes(page, 'the low-pressure fuel sys- tem')).toBe(true)
        expect(passes(page, 'the low\u2010 pressure fuel system')).toBe(true)
        expect(passes('code 5\u2010\n10', 'code 5-10')).toBe(true)
    })

    test('reads a split after a word that ends in a combining mark', () => {
        expect(passes('हिंदी-\nभाषा', 'हिंदी-भाषा')).toBe(true)
        expect(passes('cafe\u0301-\nteria', 'cafe\u0301teria')).toBe(true)
        expect(passes('cafe\u0301-\n5', 'cafe\u0301-5')).toBe(true)
    })

    test('reads regex characters in a quote as plain text', () => {
        expect(passes('cost (a+b) is $5.\nsee [1]', 'cost (a+b) is $5. see [1]')).toBe(true)
        expect(passes('cost aab is 5', 'cost (a+b) is 5')).toBe(false)
    })

    test('joins only between letters and digits, and drops the hyphen only between letters', () => {
        expect(passes('5 -\n10 bar', '-10 bar')).toBe(false)
        expect(passes('not -\nsupported', 'not supported')).toBe(false)
        expect(passes('code 5-\n10 ok', 'code 510 ok')).toBe(false)
        expect(passes('code 5-\n10 ok', 'code 5-10 ok')).toBe(true)
        expect(passes('see VX-\n(note)', 'see VX-(note)')).toBe(false)
        expect(passes('a 5-\nfold rise', 'a 5fold rise')).toBe(false)
        expect(passes('number VX-\n4471', 'number VX4471')).toBe(false)
    })
})
