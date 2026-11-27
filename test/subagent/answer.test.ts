import {describe, expect, test} from 'bun:test'

import {
    AnswerErrors,
    layoutPrompt,
    missingFrom,
    parseAnswer,
    substantive,
    verifyAnswer
} from '../../src/subagent/answer'

const page = '# Zorblax CLI\n\nInstall it with `cargo install zorblax`. The default port is 4817.'
describe('parseAnswer', () => {
    test('reads the layout with the answer on its own lines', () => {
        const text =
            'COVERED: yes\nANSWER:\nThe port is 4817.\nEVIDENCE:\nThe default port is 4817.'
        expect(parseAnswer(text)).toEqual({
            covered: 'yes',
            answer: 'The port is 4817.',
            evidence: ['The default port is 4817.']
        })
    })

    test('reads the answer from the label line and keeps its later lines', () => {
        const text = 'COVERED: partial\nANSWER: line one\nline two\n\nline three\nEVIDENCE:\na\nb'
        expect(parseAnswer(text)).toEqual({
            covered: 'partial',
            answer: 'line one\nline two\n\nline three',
            evidence: ['a', 'b']
        })
    })

    test('reads labels dressed in emphasis, backticks or another case', () => {
        const dressed = '**COVERED:** Yes.\n**Answer**: use `pad()`\n`EVIDENCE:`\nexport const pad'
        expect(parseAnswer(dressed)).toEqual({
            covered: 'yes',
            answer: 'use `pad()`',
            evidence: ['export const pad']
        })
        expect(parseAnswer('Covered: partial\nanswer: x\nEVIDENCE: y')?.covered).toBe('partial')
        expect(parseAnswer('COVERED: **yes**\nANSWER: x\nEVIDENCE:\ny')?.covered).toBe('yes')
        expect(parseAnswer('COVERED: yes\nANSWER:`pad()` pads\nEVIDENCE:\ny')?.answer).toBe(
            '`pad()` pads'
        )
    })

    test('reads a reply wrapped whole in a code fence', () => {
        const text = '```text\nCOVERED: yes\nANSWER: x\nEVIDENCE:\ny\n```'
        expect(verifyAnswer(text, [{text: 'y', wholeLines: false}])).toBe(text)
    })

    test('the first EVIDENCE label in any case splits, so no quote escapes the check', () => {
        expect(parseAnswer('Covered: yes\nAnswer: x\nEvidence: foo\nbar')?.evidence).toEqual([
            'foo',
            'bar'
        ])
        expect(
            parseAnswer('COVERED: yes\nANSWER: a\nEVIDENCE:\nEvidence: quoted')?.evidence
        ).toEqual(['Evidence: quoted'])
        const source = [{text: 'config file\nevidence: true\nEVIDENCE: x\nother', wholeLines: true}]
        for (const reply of [
            'Covered: yes\nAnswer: it is on\nEvidence:\ninvented line\nevidence: true',
            'Covered: yes\nAnswer: it is on\nEvidence:\ninvented line\nEVIDENCE: x'
        ])
            expect(() => verifyAnswer(reply, source)).toThrow(
                AnswerErrors.Invented + 'invented line'
            )
    })

    test('an answer that itself says evidence: fails closed, never open', () => {
        const reply = 'COVERED: yes\nANSWER: set\nevidence: true\nmore\nEVIDENCE:\nother'
        expect(() =>
            verifyAnswer(reply, [{text: 'other\nevidence: true', wholeLines: true}])
        ).toThrow(AnswerErrors.Invented)
    })

    test('emphasis that starts the content stays when nothing parts it from the colon', () => {
        expect(parseAnswer('COVERED: yes\nANSWER:**bold** x\nEVIDENCE:\ny')?.answer).toBe(
            '**bold** x'
        )
        expect(parseAnswer('COVERED: yes\nANSWER: x\nEVIDENCE:__init__.py\n')?.evidence).toEqual([
            '__init__.py'
        ])
    })

    test('a coverage word that only starts like one is not read as it', () => {
        expect(parseAnswer('COVERED: yesterday\nANSWER: x\nEVIDENCE:\ny')).toBeUndefined()
        expect(parseAnswer('COVERAGE: yes\nANSWER: x\nEVIDENCE:\ny')).toBeUndefined()
    })

    test('accepts no evidence and mixed case coverage', () => {
        expect(parseAnswer('COVERED: No\nANSWER: Not here.\nEVIDENCE:\n')).toEqual({
            covered: 'no',
            answer: 'Not here.',
            evidence: []
        })
    })

    test('trims evidence lines and drops blank ones', () => {
        const text = 'COVERED: yes\nANSWER: x\nEVIDENCE:\na\n\n  c  \n'
        expect(parseAnswer(text)?.evidence).toEqual(['a', 'c'])
    })

    test('takes evidence written on the label line', () => {
        const text = 'COVERED: yes\nANSWER: x\nEVIDENCE: a\nb'
        expect(parseAnswer(text)?.evidence).toEqual(['a', 'b'])
    })

    test('ignores trailing spaces, windows line ends and blank lines around labels', () => {
        const text = 'COVERED: yes \r\n\r\nANSWER: x\r\n\r\nEVIDENCE: \r\na\r\n'
        expect(parseAnswer(text)).toEqual({covered: 'yes', answer: 'x', evidence: ['a']})
    })

    test('keeps indentation inside the answer', () => {
        const text = 'COVERED: yes\nANSWER:\nif x:\n    y()\nEVIDENCE:\na'
        expect(parseAnswer(text)?.answer).toBe('if x:\n    y()')
    })

    test('tolerates surrounding whitespace', () => {
        expect(parseAnswer('\n\nCOVERED: yes\nANSWER: x\nEVIDENCE:\na\n\n')?.answer).toBe('x')
    })

    test('rejects a missing or unknown coverage', () => {
        expect(parseAnswer('ANSWER: x\nEVIDENCE:\n')).toBeUndefined()
        expect(parseAnswer('COVERED: maybe\nANSWER: x\nEVIDENCE:\n')).toBeUndefined()
    })

    test('rejects a missing answer label or empty answer', () => {
        expect(parseAnswer('COVERED: yes\nx\nEVIDENCE:\n')).toBeUndefined()
        expect(parseAnswer('COVERED: yes\nANSWER:\nEVIDENCE:\n')).toBeUndefined()
    })

    test('rejects a cut off reply with no evidence marker', () => {
        expect(parseAnswer('COVERED: yes\nANSWER: The port is')).toBeUndefined()
    })

    test('a fenced reply is read, and its closing fence is no evidence', () => {
        expect(() => verifyAnswer('```\nCOVERED: yes\nANSWER: x\nEVIDENCE:\n```', [])).toThrow(
            AnswerErrors.NoEvidence
        )
    })
})

const prose = (text: string) => ({text, wholeLines: false})
const code = (text: string) => ({text, wholeLines: true})
describe('missingFrom', () => {
    test('prose: passes any run found, ignoring whitespace and emphasis', () => {
        expect(missingFrom(['The default port is 4817.', '# Zorblax CLI'], [prose(page)])).toEqual(
            []
        )
        expect(missingFrom(['Zorblax CLI\n\nInstall it  with cargo'], [prose(page)])).toEqual([])
        expect(missingFrom(['second'], [prose('first'), prose('the second text')])).toEqual([])
        expect(
            missingFrom(
                [
                    'If the encoding option is specified then this function returns a string. Otherwise it returns a buffer.'
                ],
                [
                    prose(
                        '    /**\n     * If the `encoding` option is specified then this function returns a\n     * string. Otherwise it returns a buffer.\n     */'
                    )
                ]
            )
        ).toEqual([])
    })

    test('a list marker or JSDoc gutter, added or dropped, is not a difference on a code line', () => {
        const readme = code('- `headingStyle`: setext or atx\n1. first step\n * - gutter item\n')
        expect(
            missingFrom(
                [
                    'headingStyle: setext or atx',
                    '- first step',
                    '* `headingStyle`: setext or atx',
                    'gutter item'
                ],
                [readme]
            )
        ).toEqual([])
        expect(missingFrom(['2. Run setup'], [prose('1. Run setup')])).toEqual(['2. Run setup'])
        expect(
            missingFrom(
                ['@deprecated Use email() instead.', 'a note'],
                [code('/** @deprecated Use email() instead. */\n// a note\n')]
            )
        ).toEqual([])
    })

    test('code: a quote must be a whole line, so a fragment found everywhere is rejected', () => {
        const dts = code('export declare function parse(): null\n  options?: Options;\n')
        expect(
            missingFrom(['export declare function parse(): null', '  options?:  Options;'], [dts])
        ).toEqual([])
        expect(missingFrom(['string;', 'export', 'options?:'], [dts])).toEqual([
            'string;',
            'export',
            'options?:'
        ])
    })

    test('returns lines no text holds, case kept', () => {
        expect(
            missingFrom(
                ['The default port is 4817.', 'The port is 3000.', 'zorblax cli'],
                [prose(page)]
            )
        ).toEqual(['The port is 3000.', 'zorblax cli'])
    })
})

describe('substantive', () => {
    test('drops fences, braces and emphasis-only lines, keeps text', () => {
        expect(substantive(['```', '***', ' ', '- ', '}', '};', 'kept `x`', '}2'])).toEqual([
            'kept `x`',
            '}2'
        ])
    })
})

describe('layoutPrompt', () => {
    test('names the source, subject and unit, and takes notes', () => {
        const text = layoutPrompt({
            source: 'page text',
            subject: 'page',
            unit: 'page line',
            answerNotes: ['Note.'],
            evidenceNotes: ['No bullets.']
        })
        expect(text).toContain('using only the page text.')
        expect(text).toContain(
            'what the page holds instead.\nNote.\nEVIDENCE:\none page line per line, every line the answer rests on, copied exactly, character for character. No bullets.'
        )
    })
})

describe('verifyAnswer', () => {
    const reply = (evidence: string) => `COVERED: yes\nANSWER:\nx\nEVIDENCE:\n${evidence}`
    const onPage = (text: string) => verifyAnswer(text, [prose(page)])
    test('returns the text untouched when every cited line is found', () => {
        expect(onPage(reply('# Zorblax CLI'))).toBe(reply('# Zorblax CLI'))
        expect(onPage(reply('```\n# Zorblax CLI\n```'))).toBe(reply('```\n# Zorblax CLI\n```'))
    })

    test('rejects a bad layout, no evidence, fences only, and an invented line', () => {
        expect(() => onPage('x')).toThrow(AnswerErrors.Layout)
        expect(() => onPage(reply(''))).toThrow(AnswerErrors.NoEvidence)
        expect(() => onPage(reply('```\n```'))).toThrow(AnswerErrors.NoEvidence)
        expect(() => onPage(reply('The port is 3000.'))).toThrow(
            AnswerErrors.Invented + 'The port is 3000.'
        )
    })

    test('lets COVERED no through with nothing cited', () => {
        expect(onPage('COVERED: no\nANSWER:\nnothing\nEVIDENCE:\n')).toBe(
            'COVERED: no\nANSWER:\nnothing\nEVIDENCE:\n'
        )
    })
})
