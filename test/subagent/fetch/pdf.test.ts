import {chmodSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, test} from 'bun:test'

import {missingFrom} from '../../../src/subagent/answer'
import {FetchErrors} from '../../../src/subagent/fetch/errors'
import {pdfText, quotable} from '../../../src/subagent/fetch/pdf'
import {pdftotextReady} from '../../pdftotext'
import {tempTree} from '../../tree'

const fixture = (name: string): Uint8Array =>
    readFileSync(new URL(`fixtures/${name}.pdf`, import.meta.url))
const limit = 10 * 1024 * 1024
const read = (name: string): Promise<string> => pdfText(fixture(name), limit)
describe.skipIf(!pdftotextReady)('pdfText', () => {
    test('reads every page and drops the form feeds between them', async () => {
        expect(await read('two-pages')).toBe('First page text\n\nSecond page text')
    })

    test('reports a PDF with no text layer', async () => {
        await expect(read('blank')).rejects.toThrow('Fetch failed: PDF has no text layer')
    })

    test('reports what pdftotext said about a broken file', async () => {
        await expect(pdfText(new TextEncoder().encode('%PDF-1.4\njunk'), limit)).rejects.toThrow(
            "Fetch failed: Syntax Error: Couldn't read xref table"
        )
    })

    // The input must outgrow the pipe buffer, or the write ends before the child dies.
    test('an aborted run rejects as aborted and leaves the process alive', async () => {
        await expect(pdfText(fixture('expands'), limit, AbortSignal.abort())).rejects.toMatchObject(
            {cause: {name: 'AbortError'}}
        )
        expect(await read('two-pages')).toContain('First page text')
    })

    test('names the missing tool when pdftotext is not on PATH', async () => {
        const path = process.env.PATH
        process.env.PATH = '/nonexistent'

        try {
            await expect(read('two-pages')).rejects.toThrow(
                'Fetch failed: PDF needs pdftotext (poppler) on PATH'
            )
        } finally {
            process.env.PATH = path
        }
    })

    test('stops at the size limit on a PDF that expands past it', async () => {
        await expect(read('expands')).rejects.toThrow(FetchErrors.PageTooBig)
    })

    test('reads a damaged PDF whose warnings outgrow the size limit', async () => {
        expect(await read('noisy')).toBe('Fit only the filter')
    })

    test('names a password protected PDF', async () => {
        await expect(read('locked')).rejects.toThrow(
            new Error('Fetch failed: PDF is password protected')
        )
    })

    test('spells a ligature as plain letters and leaves other symbols alone', async () => {
        expect(await read('ligature')).toBe('configure the pump\narea 5 m²')
    })

    test('joins a word split by a soft hyphen, at a line end or inside a line', async () => {
        expect(await read('soft-hyphen')).toBe('several important points\none important line')
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
})

const withFakePdftotext = async (script: string, run: () => unknown): Promise<void> => {
    const dir = tempTree({pdftotext: `#!/bin/sh\n${script}\n`})
    chmodSync(join(dir, 'pdftotext'), 0o755)
    const path = process.env.PATH
    process.env.PATH = dir

    try {
        await run()
    } finally {
        process.env.PATH = path
    }
}
// The fake is a /bin/sh script, which Windows cannot run.
describe.skipIf(process.platform === 'win32')('a fake pdftotext', () => {
    test('names an old pdftotext that has no -remove-hyphens', () =>
        withFakePdftotext('echo "Usage: pdftotext [options]" >&2\nexit 99', () =>
            expect(pdfText(new Uint8Array([0x25]), limit)).rejects.toThrow(
                'Fetch failed: pdftotext is too old, it needs the -remove-hyphens option of a newer poppler'
            )
        ))

    test('reports any other exit 99 by what pdftotext said', () =>
        withFakePdftotext('echo "Internal Error: out of memory" >&2\nexit 99', () =>
            expect(pdfText(new Uint8Array([0x25]), limit)).rejects.toThrow(
                'Fetch failed: Internal Error: out of memory'
            )
        ))

    test('asks for unix line ends, which the split patterns read', () =>
        withFakePdftotext('echo "$@" >&2\nexit 1', () =>
            expect(pdfText(new Uint8Array([0x25]), limit)).rejects.toThrow('-eol unix')
        ))

    test('reads usage text only where a line starts with it', () =>
        withFakePdftotext(`echo "Syntax Error: Unknown font tag 'Usage:'" >&2\nexit 1`, () =>
            expect(pdfText(new Uint8Array([0x25]), limit)).rejects.toThrow(
                new Error("Fetch failed: Syntax Error: Unknown font tag 'Usage:'")
            )
        ))

    test('reports a last line with no line end', () =>
        withFakePdftotext(`printf 'Internal Error: x' >&2\nexit 1`, () =>
            expect(pdfText(new Uint8Array([0x25]), limit)).rejects.toThrow(
                new Error('Fetch failed: Internal Error: x')
            )
        ))

    test('reports a crash by its signal, not the warning before it', () =>
        withFakePdftotext('echo "Syntax Warning: bad font" >&2\nkill -SEGV $$', () =>
            expect(pdfText(new Uint8Array([0x25]), limit)).rejects.toThrow(
                new Error('Fetch failed: pdftotext stopped on SIGSEGV')
            )
        ))

    test('reports a silent failure by its exit code', () =>
        withFakePdftotext('exit 3', () =>
            expect(pdfText(new Uint8Array([0x25]), limit)).rejects.toThrow(
                new Error('Fetch failed: pdftotext exited with 3')
            )
        ))

    // Longer than a pipe read, so the reason arrives in pieces.
    test('reports a reason line that arrives in pieces', () => {
        const reason = 'x'.repeat(200_000)
        return withFakePdftotext(`echo ${reason} >&2\nexit 1`, () =>
            expect(pdfText(new Uint8Array([0x25]), limit)).rejects.toThrow(
                new Error(FetchErrors.Failed + reason)
            )
        )
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
