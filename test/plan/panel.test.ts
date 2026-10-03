import {beforeEach, describe, expect, mock, test} from 'bun:test'
import type {Theme} from '@earendil-works/pi-coding-agent'
import {visibleWidth} from '@earendil-works/pi-tui'

import type {PanelState, PlanPanel as Panel} from '../../src/plan/panel'

const plain = (text: string) => text
const actual = await import('@earendil-works/pi-coding-agent')
await mock.module('@earendil-works/pi-coding-agent', () => ({
    ...actual,
    getSelectListTheme: () => ({
        selectedPrefix: plain,
        selectedText: (text: string) => text.replace(/→ (.*)/, '→ <$1>'),
        description: plain,
        scrollInfo: plain,
        noMatch: plain
    })
}))

const {PlanPanel, rows} = await import('../../src/plan/panel')

const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text
} as unknown as Theme
const enter = '\r'
const escape = '\x1b'
const up = '\x1b[A'
const down = '\x1b[B'
const width = 60
const wide = 100
const change = mock((_text: string) => undefined)
const accept = mock((_text: string) => undefined)
const handOver = mock((_text: string) => undefined)
const close = mock((_text: string) => undefined)
const leave = mock((_text: string) => undefined)
const answer = mock((_text: string) => undefined)
const ask = mock((_text: string) => undefined)
const plan = mock((_text: string) => undefined)
const finish = mock((_text: string) => undefined)
const changeGoal = mock((_text: string) => undefined)
const stop = mock((_text: string) => undefined)
const repaint = mock(() => undefined)
const actions = {
    change,
    accept,
    answer,
    ask,
    plan,
    finish,
    changeGoal,
    handOver,
    stop,
    close,
    leave
}
const question = {
    question: 'Which greeting?',
    options: ['Hello, ${name}!', 'A long\nfriendly \x1b[31mgreeting\x1b[0m'],
    evidence: {file: 'src/greet.js', line: '  export const greet = 1'}
}
const asking = {goal: 'Fix the typo.', accepted: true, question}
const state = (over: Partial<PanelState> = {}): PanelState => ({
    accepted: false,
    asked: false,
    handed: false,
    decisions: [],
    steps: [],
    files: [],
    running: false,
    status: '',
    ...over
})

const type = (panel: Panel, text: string) => {
    for (const char of text) panel.handleInput(char)
}

const hint = (panel: Panel) => panel.render(wide).at(-1)
let panel: Panel
let limit = Number.POSITIVE_INFINITY
beforeEach(() => {
    for (const fn of [...Object.values(actions), repaint]) fn.mockClear()
    limit = Number.POSITIVE_INFINITY
    panel = new PlanPanel(theme, repaint, actions, () => limit)
})

describe('PlanPanel', () => {
    test('empty state asks for the request and shows no menu', () => {
        panel.setState(state())
        const lines = panel.render(width)
        expect(lines[0]).toBe('● Goal   ○ Questions   ○ Steps   ○ Hand over')
        expect(lines).toContain('Type what you want done.')
        expect(lines.join('\n')).not.toContain(rows.accept.label)
        expect(hint(panel)).toBe('type your request  ·  enter sends  ·  esc close')
    })

    test('a request with no goal yet is shown in place of the prompt', () => {
        panel.setState(state({request: 'fix it', running: true}))
        const lines = panel.render(width)
        expect(lines).toContain('fix it')
        expect(lines).not.toContain('Type what you want done.')
    })

    test('a running panel keeps its own clock', () => {
        panel.setState(state({request: 'fix it', running: true}))
        panel['spinner'].startedAt = Date.now() - 12_000
        expect(panel.render(width).join('\n')).toContain('subagent · 00:12 · starting…')

        panel.setState(state({request: 'fix it', running: true}))
        expect(panel.render(width).join('\n')).toContain('00:12')

        panel.setState(state({goal: 'Fix it.'}))
        panel.setState(state({goal: 'Fix it.', running: true}))
        expect(panel.render(width).join('\n')).toContain('00:00')
    })

    test('enter sends the typed text and clears the input', () => {
        panel.setState(state())
        type(panel, 'fix it')
        expect(hint(panel)).toBe('enter sends  ·  esc clears')
        panel.handleInput(enter)

        expect(change).toHaveBeenCalledWith('fix it')
        expect(panel.render(width).join('\n')).not.toContain('fix it')
    })

    test('escape clears typed text before it leaves', () => {
        panel.setState(state())
        type(panel, 'fix it')
        panel.handleInput(escape)
        expect(leave).not.toHaveBeenCalled()
        expect(panel.render(width).join('\n')).not.toContain('fix it')

        panel.handleInput(escape)
        expect(leave).toHaveBeenCalledTimes(1)
        expect(close).not.toHaveBeenCalled()
    })

    test('a goal shows the menu with accept first', () => {
        panel.setState(state({goal: 'Fix the typo.'}))
        const text = panel.render(width).join('\n')
        expect(text).toContain('GOAL')
        expect(text).toContain('Fix the typo.')
        expect(text).toContain(rows.accept.label)
        expect(text).toContain(rows.handOver.label)
        expect(text).toContain(rows.close.label)
        expect(hint(panel)).toBe(
            'type to change  ·  ↑↓ pick  ·  enter accept the goal  ·  esc close'
        )
    })

    test('enter on an empty input runs the highlighted row', () => {
        panel.setState(state({goal: 'Fix the typo.'}))
        panel.handleInput(enter)
        expect(accept).toHaveBeenCalledTimes(1)

        panel.handleInput(down)
        expect(hint(panel)).toBe(
            'type to change  ·  ↑↓ pick  ·  enter send to main context  ·  esc close'
        )
        panel.handleInput(enter)
        expect(handOver).toHaveBeenCalledTimes(1)

        panel.handleInput(up)
        panel.handleInput(up)
        panel.handleInput(enter)
        expect(close).toHaveBeenCalledTimes(1)
        expect(leave).not.toHaveBeenCalled()
    })

    test('typed text takes enter away from the menu', () => {
        panel.setState(state({goal: 'Fix the typo.'}))
        type(panel, 'more')
        panel.handleInput(down)
        panel.handleInput(enter)

        expect(accept).not.toHaveBeenCalled()
        expect(handOver).not.toHaveBeenCalled()
        expect(change).toHaveBeenCalledWith('more')
    })

    test('typed text drops the highlight from the selected row', () => {
        panel.setState(state({goal: 'Fix the typo.'}))
        const highlighted = panel.render(width).join('\n')
        type(panel, 'more')

        expect(highlighted).toContain(`<${rows.accept.label}>`)
        expect(panel.render(width).join('\n')).not.toContain(`<${rows.accept.label}>`)
    })

    test('invalidate keeps the typed text', () => {
        panel.setState(state())
        type(panel, 'fix it')
        panel.invalidate()

        expect(panel.render(width).join('\n')).toContain('fix it')
    })

    test('accepted goal moves the strip and leads with ask questions', () => {
        panel.setState(state({goal: 'Fix the typo.', accepted: true}))
        const lines = panel.render(width)
        expect(lines[0]).toBe('✓ Goal   ● Questions   ○ Steps   ○ Hand over')
        expect(lines).toContain('✓ GOAL')
        expect(lines.join('\n')).not.toContain(rows.accept.label)
        expect(hint(panel)).toBe('↑↓ pick  ·  enter ask questions  ·  esc close')
        panel.handleInput(enter)
        expect(ask).toHaveBeenCalledTimes(1)
    })

    test('after accept there is no input and typed text goes nowhere', () => {
        panel.setState(state({goal: 'Fix the typo.', accepted: true}))
        type(panel, 'more')
        panel.handleInput(enter)

        const text = panel.render(width).join('\n')
        expect(text).not.toContain('> ')
        expect(text).toContain(`Fix the typo.\n\n→ <${rows.ask.label}>`)
        expect(change).not.toHaveBeenCalled()
        expect(ask).toHaveBeenCalledTimes(1)
    })

    test('finished questions with no steps lead with plan steps and take no text', () => {
        panel.setState(state({goal: 'Fix the typo.', accepted: true, asked: true}))
        const lines = panel.render(width)
        expect(lines[0]).toBe('✓ Goal   ✓ Questions   ● Steps   ○ Hand over')
        expect(lines.join('\n')).not.toContain(rows.ask.label)
        expect(lines.join('\n')).not.toContain('> ')
        expect(hint(panel)).toBe('↑↓ pick  ·  enter plan steps  ·  esc close')
        type(panel, 'more')
        panel.handleInput(enter)
        expect(plan).toHaveBeenCalledTimes(1)
        expect(change).not.toHaveBeenCalled()

        panel.handleInput(down)
        panel.handleInput(enter)
        expect(handOver).toHaveBeenCalledTimes(1)
        panel.handleInput(down)
        panel.handleInput(enter)
        expect(changeGoal).toHaveBeenCalledTimes(1)
    })

    describe('with steps', () => {
        const planned = {
            goal: 'Fix the typo.',
            accepted: true,
            asked: true,
            steps: ['Fix `greet` in \x1b[31msrc/greet.js\x1b[0m.', 'Add a test.'],
            files: [
                {path: 'src/greet.js', state: 'existing' as const},
                {path: 'test/greet.test.js', state: 'new' as const}
            ]
        }
        test('the steps and files show, and hand over is the current step and the first row', () => {
            panel.setState(state(planned))
            const lines = panel.render(width)
            expect(lines[0]).toBe('✓ Goal   ✓ Questions   ✓ Steps   ● Hand over')
            expect(lines.join('\n')).toContain(
                [
                    '',
                    'STEPS',
                    '1. Fix `greet` in src/greet.js.',
                    '2. Add a test.',
                    '',
                    'FILES',
                    'src/greet.js (existing)',
                    'test/greet.test.js (new)',
                    ''
                ].join('\n')
            )
            expect(lines.join('\n')).not.toContain(rows.plan.label)
            panel.handleInput(enter)
            expect(handOver).toHaveBeenCalledTimes(1)

            panel.handleInput(down)
            panel.handleInput(enter)
            expect(changeGoal).toHaveBeenCalledTimes(1)
        })

        test('typed text is a change', () => {
            panel.setState(state(planned))
            expect(hint(panel)).toBe(
                'type to change  ·  ↑↓ pick  ·  enter send to main context  ·  esc close'
            )
            type(panel, 'no test')
            panel.handleInput(enter)

            expect(change).toHaveBeenCalledWith('no test')
            expect(handOver).not.toHaveBeenCalled()
        })

        test('a run over saved steps puts the strip back on steps and takes no text', () => {
            panel.setState(state({...planned, running: true}))
            type(panel, 'more')

            const lines = panel.render(width)
            expect(lines[0]).toBe('✓ Goal   ✓ Questions   ● Steps   ○ Hand over')
            expect(lines.join('\n')).not.toContain('> ')
        })

        test('a plan with no files has no files heading', () => {
            panel.setState(state({...planned, files: []}))

            expect(panel.render(width)).not.toContain('FILES')
        })

        test('a long step wraps to the width', () => {
            panel.setState(state({...planned, steps: ['word '.repeat(30).trim()]}))

            for (const line of panel.render(width))
                expect(visibleWidth(line)).toBeLessThanOrEqual(width)
            expect(
                panel.render(width).filter(line => line.includes('word')).length
            ).toBeGreaterThan(1)
        })

        describe('after hand over', () => {
            const progress = {
                files: [true, false],
                steps: ['done', 'open', 'untracked'] as const,
                outside: ['NOTES.md'],
                written: 1,
                total: 2
            }
            const handed = state({
                ...planned,
                steps: ['Fix greet.', 'Add a test.', 'Run the tests.'],
                handed: true,
                progress: {...progress, steps: [...progress.steps]}
            })
            const text = () => panel.render(width).join('\n')
            test('every strip item is done', () => {
                panel.setState(handed)

                expect(panel.render(width)[0]).toBe('✓ Goal   ✓ Questions   ✓ Steps   ✓ Hand over')
            })

            test('each step and file carries its mark, and outside files are listed', () => {
                panel.setState(handed)

                expect(text()).toContain('✓ 1. Fix greet.\n○ 2. Add a test.\n· 3. Run the tests.')
                expect(text()).toContain('FILES\n✓ src/greet.js (existing)\n○ ')
                expect(text()).toContain('OUTSIDE\nNOTES.md')
            })

            test('no outside file, no outside heading', () => {
                panel.setState({...handed, progress: {...progress, steps: [], outside: []}})

                expect(text()).not.toContain('OUTSIDE')
            })

            test('a plan with no files still shows its outside files, listed or counted', () => {
                const bare = {...handed, files: [], progress: {...progress, steps: [], files: []}}
                panel.setState(bare)
                const full = panel.render(width).length
                expect(text()).toContain('OUTSIDE\nNOTES.md')
                expect(text()).not.toContain('FILES')
                limit = full - 2

                expect(text()).toContain('3. Run the tests.\n\nOutside: 1\n')
                panel.setState({...bare, progress: {...bare.progress, outside: []}})
                limit = panel.render(width).length - 1

                expect(text()).toContain('3. Run the tests.\n\n→')
            })

            test('the rows stop the tracking or close, and typed text goes nowhere', () => {
                panel.setState(handed)
                type(panel, 'more')
                panel.handleInput(enter)

                expect(text()).toContain(`→ <${rows.stop.label}>\n  ${rows.close.label}`)
                expect(text()).not.toContain(rows.handOver.label)
                expect(text()).not.toContain('> ')
                expect(stop).toHaveBeenCalledTimes(1)
                expect(change).not.toHaveBeenCalled()
            })

            test('before the first count the plan shows with no marks', () => {
                panel.setState({...handed, progress: undefined})

                expect(text()).toContain('STEPS\n1. Fix greet.')
                expect(text()).toContain('FILES\nsrc/greet.js (existing)')
            })

            test('a short screen turns files and outside into counts, then the steps', () => {
                panel.setState(handed)
                const full = panel.render(width).length
                limit = full - 3

                expect(text()).toContain('· 3. Run the tests.\n\nFiles: 1/2\nOutside: 1\n')
                expect(panel.render(width).length).toBeLessThanOrEqual(limit)
                limit = full - 9

                expect(text()).toContain('Steps: 3 · done 1\nFiles: 1/2\nOutside: 1\n')
                expect(panel.render(width).length).toBeLessThanOrEqual(limit)
            })
        })

        describe('on a screen that is too short', () => {
            const long = {...planned, steps: ['word '.repeat(30).trim(), 'Add a test.']}
            const text = () => panel.render(width).join('\n')

            const fitted = () => {
                panel.setState(state(long))
                return panel.render(width).length
            }
            test('after the goal, each step shrinks to one line', () => {
                limit = fitted() - 2

                expect(text()).toContain('…')
                expect(text()).toContain('FILES\nsrc/greet.js (existing)')
                expect(panel.render(width).length).toBeLessThanOrEqual(limit)
            })

            test('then the files shrink to a count', () => {
                limit = fitted() - 4

                expect(text()).toContain('2. Add a test.\n\nFiles: 2\n')
                expect(text()).not.toContain('FILES')
            })

            test('then the steps shrink to a count', () => {
                limit = fitted() - 6

                expect(text()).toContain('Fix the typo.\nSteps: 2\nFiles: 2\n')
                expect(text()).not.toContain('STEPS')
                expect(text()).toContain('→ <Send to main context>')
                expect(panel.render(width).length).toBeLessThanOrEqual(limit)
            })
        })
    })

    test('a waiting question shows its quote, full options and one row per option', () => {
        panel.setState(state(asking))
        const lines = panel.render(width)
        expect(lines).toContain('QUESTION')
        expect(lines).toContain('Which greeting?')
        expect(lines).toContain('src/greet.js: export const greet = 1')
        expect(lines).toContain('2. A long')
        expect(lines).toContain('friendly greeting')
        expect(lines.join('\n')).toContain('→ <1. Hello, ${name}!>')
        expect(lines.join('\n')).toContain('2. A long friendly greeting')
        expect(lines.join('\n')).toContain('> ')
        expect(hint(panel)).toBe('type your answer  ·  ↑↓ pick  ·  enter answer 1  ·  esc close')
        panel.handleInput(down)
        panel.handleInput(down)
        expect(hint(panel)).toContain('enter finish questions')
    })

    test('a question with no quote shows none', () => {
        panel.setState(state({...asking, question: {...question, evidence: undefined}}))

        expect(panel.render(width).join('\n')).not.toContain('src/greet.js')
    })

    test('enter on an option row answers with the full option text', () => {
        panel.setState(state(asking))
        panel.handleInput(down)
        panel.handleInput(enter)

        expect(answer).toHaveBeenCalledWith(question.options[1])
    })

    test('typed text is the answer while a question waits', () => {
        panel.setState(state(asking))
        type(panel, 'Hey')
        panel.handleInput(enter)

        expect(answer).toHaveBeenCalledWith('Hey')
        expect(change).not.toHaveBeenCalled()
    })

    test('the rows under the options finish, change the goal and close', () => {
        panel.setState(state(asking))

        for (const action of [close, changeGoal, finish]) {
            panel.handleInput(up)
            panel.handleInput(enter)
            expect(action).toHaveBeenCalledTimes(1)
        }

        expect(answer).not.toHaveBeenCalled()
    })

    describe('on a screen that is too short', () => {
        const decisions = [
            {question: 'Add a test?', answer: 'No'},
            {question: 'Which file?', answer: 'src/greet.js'}
        ]
        const tall = state({...asking, goal: 'word '.repeat(30).trim(), decisions})
        const height = () => panel.render(width).length
        const text = () => panel.render(width).join('\n')
        test('everything shows when it fits', () => {
            panel.setState(tall)
            limit = height()

            expect(text()).toContain('✓ No')
            expect(text()).toContain('friendly greeting')
        })

        test('old answers shrink to a count first', () => {
            panel.setState(tall)
            limit = height() - 1

            expect(text()).toContain('✓ Answered questions: 2')
            expect(text()).not.toContain('Add a test?')
            expect(panel.render(width).filter(line => line.startsWith('word')).length).toBe(3)
            expect(height()).toBeLessThanOrEqual(limit)
        })

        test('then the goal shrinks to one line', () => {
            panel.setState(tall)
            limit = height() - 1
            limit = height() - 1
            const lines = panel.render(width)
            expect(lines.filter(line => line.includes('word')).length).toBe(1)
            expect(lines.find(line => line.includes('word'))).toStartWith('✓ GOAL  word word')
            expect(lines.every(line => visibleWidth(line) <= width)).toBe(true)
            expect(lines).toContain('friendly greeting')
        })

        test('then only the highlighted option shows in full, under the rows', () => {
            panel.setState(tall)
            limit = 20
            const lines = panel.render(width)
            expect(lines.indexOf('1. Hello, ${name}!')).toBeGreaterThan(lines.indexOf('  Close'))
            expect(lines).not.toContain('friendly greeting')
            expect(lines.length).toBeLessThanOrEqual(limit)

            panel.handleInput(down)
            const next = panel.render(width)
            expect(next).toContain('friendly greeting')
            expect(next.length).toBe(lines.length)

            panel.handleInput(down)
            expect(panel.render(width).length).toBe(lines.length)
            expect(panel.render(width)).not.toContain('friendly greeting')
        })

        test('when nothing fits the body is cut and the controls stay', () => {
            panel.setState(tall)
            limit = 14
            const lines = panel.render(width)
            expect(lines.length).toBe(limit)
            expect(lines.slice(0, 3)).toEqual([
                'QUESTION',
                'Which greeting?',
                'src/greet.js: export const greet = 1'
            ])
            expect(lines).toContain('1. Hello, ${name}!')
            expect(lines).toContain('  Close')
            expect(lines.at(-2)).toStartWith('type your answer')
            expect(text()).not.toContain('✓ Goal')
        })

        test('with less room the picked option goes, then the heading, the quote and the text', () => {
            panel.setState(tall)
            limit = 13
            expect(panel.render(width).slice(0, 3)).toEqual([
                'QUESTION',
                'Which greeting?',
                'src/greet.js: export const greet = 1'
            ])
            expect(panel.render(width)).not.toContain('1. Hello, ${name}!')

            limit = 12
            expect(panel.render(width).slice(0, 2)).toEqual([
                'Which greeting?',
                'src/greet.js: export const greet = 1'
            ])

            limit = 11
            expect(panel.render(width)[0]).toBe('Which greeting?')
            expect(panel.render(width)[1]).toStartWith('> ')
            expect(panel.render(width).length).toBe(limit)
        })

        test('the question text wins over a full menu, which scrolls instead', () => {
            panel.setState(tall)
            limit = 10
            const lines = panel.render(width)
            expect(lines[0]).toBe('Which greeting?')
            expect(lines).toContain('→ <1. Hello, ${name}!>')
            expect(lines.join(' ')).toContain('(1/5)')
            expect(lines.length).toBe(limit)
        })

        test('ten options still leave the question on screen', () => {
            const options = Array.from({length: 10}, (_, index) => `option ${String(index)}`)
            panel.setState(state({...tall, question: {...question, options}}))
            limit = 17
            const lines = panel.render(76)
            expect(lines).toContain('Which greeting?')
            expect(lines).toContain('→ <1. option 0>')
            expect(lines.length).toBeLessThanOrEqual(limit)
        })

        test('a long error keeps its first lines and leaves the rows and hints', () => {
            const error = 'provider said no '.repeat(40).trim()
            panel.setState(state({goal: 'Fix the typo.', accepted: true, error}))
            limit = 12
            const lines = panel.render(56)
            expect(lines.length).toBeLessThanOrEqual(limit)
            expect(lines.filter(line => line.includes('provider said no')).length).toBeGreaterThan(
                0
            )
            expect(lines).toContain('→ <Ask questions>')
            expect(lines).toContain('  Close')
            expect(lines.join(' ')).toContain('esc close')

            limit = 1
            expect(panel.render(56).filter(line => line.includes('provider')).length).toBe(1)
        })

        test('room past the question goes to a gap, then to the goal', () => {
            panel.setState(tall)
            limit = 16
            expect(panel.render(width).slice(0, 4)).toEqual([
                'QUESTION',
                'Which greeting?',
                'src/greet.js: export const greet = 1',
                ''
            ])
            expect(panel.render(width)[4]).toStartWith('> ')

            limit = 18
            expect(panel.render(width).slice(0, 3)).toEqual([
                '✓ Answered questions: 2',
                '',
                'QUESTION'
            ])
            expect(panel.render(width).length).toBe(limit)
        })

        test('with no question the room goes to the end of the goal and answers', () => {
            panel.setState(state({...tall, question: undefined, asked: true}))
            limit = 8
            const lines = panel.render(width)
            expect(lines.slice(0, 3)).toEqual(['✓ Answered questions: 2', '', '→ <Plan steps>'])
            expect(lines.length).toBe(limit)
        })

        test('a menu taller than the screen scrolls and keeps the highlighted row', () => {
            panel.setState(tall)
            limit = 7

            for (let i = 0; i < 4; i += 1) panel.handleInput(down)

            const lines = panel.render(width)
            expect(lines).toContain('→ <Close>')
            expect(lines.join(' ')).toContain('type your answer')
            expect(lines.length).toBeLessThanOrEqual(limit)

            limit = 1
            expect(panel.render(width)).toContain('→ <Close>')
        })

        test('a new state puts the highlight back on the first row', () => {
            panel.setState(tall)
            for (let i = 0; i < 4; i += 1) panel.handleInput(down)
            panel.setState(state({goal: 'Fix the typo.', accepted: true, asked: true}))
            panel.handleInput(enter)

            expect(plan).toHaveBeenCalledTimes(1)
            expect(close).not.toHaveBeenCalled()
        })

        test('a very long option gives way to the question, and nothing runs past the limit', () => {
            const long = 'long option text '.repeat(30).trim()
            const options = [long, 'b', 'c', 'd', 'e']
            panel.setState(state({...tall, question: {...question, options}}))
            limit = 21
            const lines = panel.render(36)
            expect(lines.length).toBe(limit)
            expect(lines).toContain('QUESTION')
            expect(lines).toContain('Which greeting?')
            expect(lines).toContain('  Close')
            expect(lines.join(' ')).toContain('type your answer')
            expect(lines.filter(line => line.includes('long option text')).length).toBeLessThan(14)
        })

        test('a state with no question still fits its goal and answers', () => {
            panel.setState(state({...tall, question: undefined, asked: true}))
            limit = 9
            const lines = panel.render(width)
            expect(lines).toContain('✓ Answered questions: 2')
            expect(lines).toContain('→ <Plan steps>')
            expect(lines.length).toBeLessThanOrEqual(limit)
        })
    })

    test('a repaint with the same rows keeps the highlight', () => {
        const waiting = state({goal: 'Fix the typo.', accepted: true, asked: true})
        panel.setState(waiting)
        panel.handleInput(down)
        panel.setState({...waiting})
        panel.handleInput(enter)

        expect(handOver).toHaveBeenCalledTimes(1)
        expect(plan).not.toHaveBeenCalled()
    })

    test('other rows, even as many, put the highlight back', () => {
        const goal = {goal: 'Fix the typo.'}
        panel.setState(state({...goal, accepted: true, asked: true, steps: ['Fix greet.']}))
        panel.handleInput(down)
        panel.setState(state(goal))
        panel.handleInput(enter)

        expect(accept).toHaveBeenCalledTimes(1)
        expect(handOver).not.toHaveBeenCalled()
    })

    test('a new question with as many options puts the highlight back', () => {
        panel.setState(state(asking))
        panel.handleInput(down)
        panel.setState(state({...asking, question: {...question}}))
        panel.handleInput(enter)

        expect(answer).toHaveBeenCalledWith(question.options[0])
    })

    test('text typed for a question that left the screen is dropped, not sent as a change', () => {
        panel.setState(state(asking))
        type(panel, 'No, not now')
        panel.setState(state({goal: 'Fix the typo.', accepted: true}))

        expect(hint(panel)).toBe('↑↓ pick  ·  enter ask questions  ·  esc close')
        panel.handleInput(enter)
        expect(change).not.toHaveBeenCalled()
        expect(ask).toHaveBeenCalledTimes(1)

        panel.handleInput(escape)
        expect(leave).toHaveBeenCalledTimes(1)
    })

    test('text typed for one question does not carry over to the next', () => {
        panel.setState(state(asking))
        type(panel, 'Hey')
        panel.setState(state({...asking, question: {...question, question: 'Add a test?'}}))
        panel.handleInput(enter)

        expect(answer).toHaveBeenCalledWith(question.options[0])
    })

    test('a repaint of the same question keeps the typed text', () => {
        const waiting = state(asking)
        panel.setState(waiting)
        type(panel, 'Hey')
        panel.setState({...waiting})
        panel.handleInput(enter)

        expect(answer).toHaveBeenCalledWith('Hey')
    })

    test('given answers stay on screen', () => {
        const decisions = [{question: 'Add a test?', answer: 'No'}]
        panel.setState(state({goal: 'Fix the typo.', accepted: true, asked: true, decisions}))
        const lines = panel.render(width)
        expect(lines).toContain('Add a test?')
        expect(lines).toContain('✓ No')
    })

    test('running shows the subagent line, no input, no menu', () => {
        panel.setState(state({goal: 'Old.', running: true, status: 'reading src/greet.js'}))
        const text = panel.render(width).join('\n')
        expect(text).toContain('subagent · 00:00 · reading src/greet.js')
        expect(text).not.toContain('> ')
        expect(text).not.toContain(rows.accept.label)
        expect(hint(panel)).toBe('esc close')
        type(panel, 'x')
        panel.handleInput(enter)
        expect(change).not.toHaveBeenCalled()
        panel.handleInput(escape)
        expect(leave).toHaveBeenCalledTimes(1)
        panel.setState(state())
    })

    test('an error shows in the body', () => {
        panel.setState(state({error: 'boom'}))

        expect(panel.render(width)).toContain('boom')
    })

    test('a long goal wraps to the width', () => {
        panel.setState(state({goal: 'word '.repeat(30).trim()}))
        const lines = panel.render(width)
        expect(lines.filter(line => line.startsWith('word')).length).toBeGreaterThan(1)
        expect(lines.every(line => visibleWidth(line) <= width)).toBe(true)
    })
})
