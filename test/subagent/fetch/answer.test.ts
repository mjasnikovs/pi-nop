import {describe, expect, test} from 'bun:test'

import {notOnPage, parseAnswer} from '../../../src/subagent/fetch/answer'

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

    test('accepts no evidence and mixed case coverage', () => {
        expect(parseAnswer('COVERED: No\nANSWER: Not here.\nEVIDENCE:\n')).toEqual({
            covered: 'no',
            answer: 'Not here.',
            evidence: []
        })
    })

    test('strips a quote prefix and blank lines from evidence', () => {
        const text = 'COVERED: yes\nANSWER: x\nEVIDENCE:\n> a\n>b\n\n  c  \n'
        expect(parseAnswer(text)?.evidence).toEqual(['a', 'b', 'c'])
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

    test('rejects a fenced reply', () => {
        expect(parseAnswer('```\nCOVERED: yes\nANSWER: x\nEVIDENCE:\n```')).toBeUndefined()
    })
})

describe('notOnPage', () => {
    const answer = (...evidence: string[]) => ({covered: 'yes' as const, answer: 'x', evidence})
    test('passes lines found on the page', () => {
        expect(notOnPage(answer('The default port is 4817.', '# Zorblax CLI'), page)).toEqual([])
    })

    test('ignores whitespace differences', () => {
        expect(notOnPage(answer('Zorblax CLI\n\nInstall it  with `cargo'), page)).toEqual([])
    })

    test('returns lines the page does not hold', () => {
        expect(notOnPage(answer('The default port is 4817.', 'The port is 3000.'), page)).toEqual([
            'The port is 3000.'
        ])
    })
})
