import {describe, expect, test} from 'bun:test'
import {execFileSync} from 'node:child_process'
import {chmodSync} from 'node:fs'

import {
    layoutNote,
    misplaced,
    parseSteps,
    sendBackSteps,
    stepsLayout,
    stepsRules,
    stepsTask,
    stepsText
} from '../../src/plan/steps'
import type {PlanFile} from '../../src/plan/steps'
import {tempTree} from '../tree'

const cwd = tempTree({'src/greet.js': 'x', 'README.md': 'x'})
const existing = (path: string): PlanFile => ({path, state: 'existing'})
const created = (path: string): PlanFile => ({path, state: 'new'})
const reply = [
    'STEPS:',
    '1. Fix greet.',
    '2. Add a test.',
    'FILES:',
    '- src/greet.js (existing)',
    '- test/greet.test.js (new)',
    'VERIFY:',
    '- npm test'
].join('\n')
const plan = {
    steps: ['Fix greet.', 'Add a test.'],
    files: [existing('src/greet.js'), created('test/greet.test.js')],
    verify: ['npm test']
}
const tail = '\nVERIFY:\n- npm test'
const verifyOf = (rows: string): string[] | undefined =>
    parseSteps(`STEPS:\n1. Fix it.\nFILES:\nVERIFY:${rows}`)?.verify
describe('wording', () => {
    test('the rules and the layout are the measured text', () => {
        expect(stepsLayout).toBe(
            'STEPS:\n1. <one line per step>\nFILES:\n- <path> (existing|new)\n'
                + "VERIFY:\n- <the project's test command, nothing else on the line>"
        )
        expect(stepsRules).toBe(
            [
                'The questions are done.',
                'You are planning, not implementing. Do not change any file.',
                'Now plan the steps that reach the goal, in order. Read the code you need.',
                'Answer with this layout and nothing else:',
                stepsLayout
            ].join('\n')
        )
    })

    test('the layout note is the measured text and ends on the layout the rules end on', () => {
        expect(layoutNote).toBe(
            '[SYSTEM NOTE: Your reply did not follow the layout, so it was not accepted. '
                + `Answer again with this layout and nothing else:\n${stepsLayout}]`
        )
    })
})

describe('parseSteps', () => {
    test('reads the steps without their numbers and the files with their tags', () => {
        expect(parseSteps(reply)).toEqual(plan)
    })

    test('text before the steps is ignored, blank lines and line ends too', () => {
        const loose = `No README yet.\r\n\r\n${reply.replaceAll('\n', '\r\n\r\n')}\r\n`
        expect(parseSteps(loose)).toEqual(plan)
    })

    test('markdown on the labels and backticks on the file rows are dropped', () => {
        const marked =
            '**STEPS:**\n1) Fix it.\n`FILES:`\n- `src/greet.js` (existing)\n-b.js (new) `\n*VERIFY:*'
        expect(parseSteps(marked)).toEqual({
            steps: ['Fix it.'],
            files: [existing('src/greet.js'), created('b.js')],
            verify: []
        })
    })

    test('the files start at the first FILES line after the steps', () => {
        const early = `FILES:\n- a.js (new)\nSTEPS:\n1. Fix it.\nFILES:\n- b.js (new)${tail}`
        expect(parseSteps(early)).toEqual({
            steps: ['Fix it.'],
            files: [created('b.js')],
            verify: ['npm test']
        })
    })

    test('a step keeps its backticks and stars', () => {
        const starred = "STEPS:\n1. Add `export * from './steps'`.\nFILES:\nVERIFY:"
        expect(parseSteps(starred)?.steps).toEqual(["Add `export * from './steps'`."])
    })

    test('no file rows is a plan with no files', () => {
        expect(parseSteps(`STEPS:\n1. Run the tests.\nFILES:${tail}`)).toEqual({
            steps: ['Run the tests.'],
            files: [],
            verify: ['npm test']
        })
    })

    // A row matched in quadratic time runs this into the test runner's time limit.
    test('a path keeps its spaces and brackets, and a long gap before the tag costs no time', () => {
        const gap = ' '.repeat(500_000)
        const odd = `STEPS:\n1. x\nFILES:\n- app/(group)/my page.tsx${gap}(new)${tail}`
        expect(parseSteps(odd)?.files).toEqual([created('app/(group)/my page.tsx')])
        expect(parseSteps(`STEPS:\n1. x\nFILES:\n- a${gap}b${tail}`)).toBeUndefined()
    })

    test('a path listed twice stays twice', () => {
        const twice = `STEPS:\n1. x\nFILES:\n- a.js (new)\n- a.js (new)${tail}`
        expect(parseSteps(twice)?.files).toEqual([created('a.js'), created('a.js')])
    })

    test('escape codes are dropped, and a step of escape codes alone is no step', () => {
        const coloured = `STEPS:\n1. \x1b[31mFix\x1b[0m it.\nFILES:${tail}`
        expect(parseSteps(coloured)?.steps).toEqual(['Fix it.'])
        expect(parseSteps(`STEPS:\n\x1b[31m\x1b[0m\nFILES:${tail}`)).toBeUndefined()
    })

    test.each([
        ['no STEPS line', '1. Fix it.\nFILES:\n- a.js (new)'],
        ['no FILES line', 'STEPS:\n1. Fix it.'],
        ['FILES before STEPS', 'FILES:\n- a.js (new)\nSTEPS:\n1. Fix it.'],
        ['no step', 'STEPS:\nFILES:\n- a.js (new)'],
        ['a step that runs on to a second line', 'STEPS:\n1. Fix it\nand test it.\nFILES:'],
        ['a bullet under a step', 'STEPS:\n1. Fix it.\n- in greet\nFILES:'],
        ['a step with no number', 'STEPS:\n- Fix it.\nFILES:'],
        ['a file with no tag', 'STEPS:\n1. Fix it.\nFILES:\n- a.js'],
        ['another tag', 'STEPS:\n1. Fix it.\nFILES:\n- a.js (modified)'],
        ['a tag in capitals', 'STEPS:\n1. Fix it.\nFILES:\n- a.js (NEW)'],
        ['text after the tag', 'STEPS:\n1. Fix it.\nFILES:\n- a.js (new) add it'],
        ['none as a file row', 'STEPS:\n1. Fix it.\nFILES:\n(none)'],
        ['a step on the STEPS line', 'STEPS: 1. Fix it.\n2. Test it.\nFILES:'],
        ['a file on the FILES line', 'STEPS:\n1. Fix it.\nFILES: - a.js (new)'],
        ['a word on the FILES line', 'STEPS:\n1. Fix it.\nFILES: none'],
        ['a file row with no path', 'STEPS:\n1. Fix it.\nFILES:\n- (new)'],
        ['a glob as a file', 'STEPS:\n1. Fix it.\nFILES:\n- test/*.test.js (new)'],
        ['a step with no space after its number', 'STEPS:\n1.Fix it.\nFILES:'],
        ['a path of backticks alone', 'STEPS:\n1. Fix it.\nFILES:\n- `` (new)'],
        ['text after the files', 'STEPS:\n1. Fix it.\nFILES:\n- a.js (new)\nDone.'],
        ['the layout given back', stepsLayout],
        ['an empty reply', '']
    ])('%s is not a plan, with a good VERIFY part too', (_name, text) => {
        expect(parseSteps(text)).toBeUndefined()
        expect(parseSteps(text + tail)).toBeUndefined()
    })

    describe('the VERIFY part', () => {
        const head = 'STEPS:\n1. Fix it.\nFILES:\n- a.js (new)'
        test('a row is a command with or without its dash, and a row said twice stays twice', () => {
            expect(verifyOf('\nnpm test\nnpm test\nbun test')).toEqual([
                'npm test',
                'npm test',
                'bun test'
            ])
            expect(verifyOf('\n- npm test\n-   bun test\n-')).toEqual(['npm test', 'bun test'])
        })

        test('a bare row beside dashed rows is not a plan, in either order', () => {
            expect(verifyOf('\n- npm test\nDone.')).toBeUndefined()
            expect(verifyOf('\nnpm test\n- bun test')).toBeUndefined()
            expect(verifyOf('\n-\nGOAL: Fix it.')).toBeUndefined()
        })

        test('a leaked closing tag after the commands is dropped, whole or cut', () => {
            const leaked = '\n- npm test\n\n</parameter>\n\n</function>\n</tool_call>\n</'
            expect(verifyOf(leaked)).toEqual(['npm test'])
            expect(verifyOf('\nnode --test\n</thinking>')).toEqual(['node --test'])
            expect(verifyOf('\n</parameter>\n</tool-call>')).toEqual([])
        })

        test('a row that only starts like a closing tag is a command', () => {
            expect(verifyOf('\n</dev/null npm test')).toEqual(['</dev/null npm test'])
            expect(verifyOf('\nnpm test </parameter>')).toEqual(['npm test </parameter>'])
            expect(verifyOf('\n<parameter>')).toEqual(['<parameter>'])
            expect(verifyOf('\necho ```')).toEqual(['echo ```'])
        })

        test.each([
            ['no row', ''],
            ['a bare dash', '\n-'],
            ['none', '\n- none'],
            ['None with no dash', '\nNone'],
            ['none in brackets', '\n- (None)'],
            ['none in backticks', '\n- `none`'],
            ['empty backticks', '\n- ``']
        ])('%s is a plan with no command', (_name, rows) => {
            expect(verifyOf(rows)).toEqual([])
        })

        test('a word beside none is a command', () => {
            expect(verifyOf('\n- none yet')).toEqual(['none yet'])
            expect(verifyOf('\n- nonexistent')).toEqual(['nonexistent'])
            expect(verifyOf('\n- echo none')).toEqual(['echo none'])
        })

        test('backticks around the whole command are dropped, any other stay with the stars', () => {
            expect(verifyOf('\n- `bun test`')).toEqual(['bun test'])
            expect(verifyOf('\n- ` bun test `\n- ` none `')).toEqual(['bun test'])
            expect(verifyOf('\n-  `bun test`\n-\t`bun test`')).toEqual(['bun test', 'bun test'])
            expect(verifyOf('\n- `a` && `b`')).toEqual(['`a` && `b`'])
            expect(verifyOf('\n- bun test test/*.test.ts `x`')).toEqual([
                'bun test test/*.test.ts `x`'
            ])
        })

        test('a dash with no space after it is part of the command', () => {
            expect(verifyOf('\n--coverage\n-bun test')).toEqual(['--coverage', '-bun test'])
            expect(verifyOf('\nnpm test -- --watch')).toEqual(['npm test -- --watch'])
        })

        test('with no dash on any row, text after the commands is a command', () => {
            expect(verifyOf('\nnpm test\nDone.')).toEqual(['npm test', 'Done.'])
        })

        test('a VERIFY line before the steps is ignored, like any text there', () => {
            expect(parseSteps(`VERIFY:\n${head}${tail}`)).toEqual({
                steps: ['Fix it.'],
                files: [created('a.js')],
                verify: ['npm test']
            })
        })

        test('the label inside a step is step text', () => {
            const inside = `STEPS:\n1. VERIFY: run it.\nFILES:${tail}`
            expect(parseSteps(inside)?.steps).toEqual(['VERIFY: run it.'])
        })

        test.each([
            ['no VERIFY line', head],
            [
                'VERIFY before FILES',
                'STEPS:\n1. Fix it.\nVERIFY:\n- npm test\nFILES:\n- a.js (new)'
            ],
            ['VERIFY before STEPS alone', `VERIFY:\n- npm test\n${head}`],
            ['a command on the VERIFY line', `${head}\nVERIFY: npm test`],
            ['a code fence', `${head}\nVERIFY:\n\`\`\`bash\nnpm test\n\`\`\``],
            ['a code fence after the command', `${head}\nVERIFY:\nnpm test\n\`\`\``],
            ['a code fence after a dash', `${head}\nVERIFY:\n- \`\`\`\n- npm test`],
            ['a second VERIFY line', `${head}\nVERIFY:\nnpm test\nVERIFY:\nbun test`],
            ['a marked label after the commands', `${head}\nVERIFY:\nnpm test\n**FILES:**`],
            ['STEPS after the commands', `${head}\nVERIFY:\nnpm test\nSTEPS:`]
        ])('%s is not a plan', (_name, text) => {
            expect(parseSteps(text)).toBeUndefined()
        })
    })
})

describe('misplaced', () => {
    test('files tagged as the disk has them pass', async () => {
        const files = [existing('src/greet.js'), created('src/none.js'), existing('README.md')]
        expect(await misplaced(cwd, files, undefined)).toBeUndefined()
    })

    test('a missing file, a directory and a path through a file are not existing', async () => {
        expect(await misplaced(cwd, [existing('src/none.js')], undefined)).toEqual(
            existing('src/none.js')
        )
        expect(await misplaced(cwd, [existing('src')], undefined)).toEqual(existing('src'))
        expect(await misplaced(cwd, [existing('README.md/x')], undefined)).toEqual(
            existing('README.md/x')
        )
    })

    test('a file on disk is not new', async () => {
        expect(await misplaced(cwd, [created('README.md')], undefined)).toEqual(
            created('README.md')
        )
    })

    test('the first wrong file in the list is the one named', async () => {
        const files = [existing('src/greet.js'), created('README.md'), existing('src/none.js')]
        expect(await misplaced(cwd, files, undefined)).toEqual(created('README.md'))
    })

    test('the path is found the way the read tool finds it', async () => {
        const files = [existing('@src/greet.js'), existing(`file://${cwd}/README.md`)]
        expect(await misplaced(cwd, files, undefined)).toBeUndefined()
    })

    test.skipIf(process.getuid?.() === 0)('a file is not opened, only found', async () => {
        chmodSync(`${cwd}/README.md`, 0)

        try {
            expect(await misplaced(cwd, [existing('README.md')], undefined)).toBeUndefined()
        } finally {
            chmodSync(`${cwd}/README.md`, 0o644)
        }
    })

    test.skipIf(Bun.which('mkfifo') === null)('a pipe is not read to no end', async () => {
        execFileSync('mkfifo', [`${cwd}/pipe`])

        expect(await misplaced(cwd, [existing('pipe')], undefined)).toEqual(existing('pipe'))
    })

    test('an aborted check names no file, since its reads failed for another reason', async () => {
        const files = [existing('src/greet.js'), existing('src/none.js')]
        expect(await misplaced(cwd, files, AbortSignal.abort())).toBeUndefined()
    })
})

describe('sendBackSteps', () => {
    const check = sendBackSteps(cwd, undefined)
    const tagged = (row: string) => `STEPS:\n1. Fix it.\nFILES:\n${row}${tail}`
    test('a plan that matches the disk is accepted', async () => {
        expect(await check(reply)).toBeUndefined()
    })

    test('a reply with no layout gets the layout note', async () => {
        expect(await check('')).toBe(layoutNote)
        expect(await check('GOAL: Fix the typo.')).toBe(layoutNote)
    })

    test('a file wrongly tagged existing gets the measured note', async () => {
        expect(await check(tagged('- src/none.js (existing)'))).toBe(
            '[SYSTEM NOTE: src/none.js is marked existing but is not on disk. '
                + 'Mark a file the plan creates as new. '
                + `Answer again with this layout and nothing else:\n${stepsLayout}]`
        )
    })

    test('a file wrongly tagged new gets the measured note', async () => {
        expect(await check(tagged('- README.md (new)'))).toBe(
            '[SYSTEM NOTE: README.md is marked new but is on disk. Mark it existing. '
                + `Answer again with this layout and nothing else:\n${stepsLayout}]`
        )
    })
})

describe('stepsText', () => {
    test('fills the layout, so parsing it gives the plan back', () => {
        expect(stepsText(plan)).toBe(reply)
        expect(parseSteps(stepsText(plan))).toEqual(plan)
    })

    test('no steps is no text', () => {
        expect(stepsText({steps: [], files: [existing('a.js')], verify: ['npm test']})).toBe('')
    })

    test('no command is no VERIFY part, and each command gets a dash', () => {
        expect(stepsText({...plan, verify: []})).toBe(reply.slice(0, -tail.length))
        expect(stepsText({...plan, verify: ['npm test', 'bun test']})).toBe(`${reply}\n- bun test`)
    })
})

describe('stepsTask', () => {
    const head = [
        'Request: nicer',
        'Current goal: Be nice.',
        'Decisions so far:',
        'Q1: a?',
        'A1: b'
    ]
    test('a session that knows the goal gets the rules alone', () => {
        expect(stepsTask([], plan)).toBe(stepsRules)
    })

    test('a fresh session gets the request, the goal and the answers first', () => {
        expect(stepsTask(head, plan)).toBe([...head, '', stepsRules].join('\n'))
    })

    test('a change goes with the rules', () => {
        expect(stepsTask([], plan, 'no test')).toBe(
            `Change asked by the user: no test\n\n${stepsRules}`
        )
    })

    test('a change in a fresh session carries the steps it changes', () => {
        expect(stepsTask(head, plan, 'no test')).toBe(
            [
                ...head,
                'Current steps:',
                reply,
                'Change asked by the user: no test',
                '',
                stepsRules
            ].join('\n')
        )
    })
})
