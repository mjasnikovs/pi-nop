import {beforeEach, describe, expect, mock, test} from 'bun:test'
import type {Theme} from '@earendil-works/pi-coding-agent'
import {visibleWidth} from '@earendil-works/pi-tui'

import {PlanPanel, rows} from '../../src/plan/panel'
import type {PanelState} from '../../src/plan/panel'

const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text
} as unknown as Theme
const enter = '\r'
const escape = '\x1b'
const up = '\x1b[A'
const down = '\x1b[B'
const width = 60
const change = mock((_text: string) => undefined)
const accept = mock((_text: string) => undefined)
const handOver = mock((_text: string) => undefined)
const close = mock((_text: string) => undefined)
const repaint = mock(() => undefined)
const state = (over: Partial<PanelState> = {}): PanelState => ({
    accepted: false,
    running: false,
    status: '',
    ...over
})

const type = (panel: PlanPanel, text: string) => {
    for (const char of text) panel.handleInput(char)
}

const hint = (panel: PlanPanel) => panel.render(width).at(-1)
let panel: PlanPanel
beforeEach(() => {
    for (const fn of [change, accept, handOver, close, repaint]) fn.mockClear()
    panel = new PlanPanel(theme, repaint, {change, accept, handOver, close})
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

    test('enter sends the typed text and clears the input', () => {
        panel.setState(state())
        type(panel, 'fix it')
        expect(hint(panel)).toBe('enter sends  ·  esc clears')
        panel.handleInput(enter)

        expect(change).toHaveBeenCalledWith('fix it')
        expect(panel.render(width).join('\n')).not.toContain('fix it')
    })

    test('escape clears typed text before it closes', () => {
        panel.setState(state())
        type(panel, 'fix it')
        panel.handleInput(escape)
        expect(close).not.toHaveBeenCalled()
        expect(panel.render(width).join('\n')).not.toContain('fix it')

        panel.handleInput(escape)
        expect(close).toHaveBeenCalledTimes(1)
    })

    test('a goal shows the menu with accept first', () => {
        panel.setState(state({goal: 'Fix the typo.'}))
        const text = panel.render(width).join('\n')
        expect(text).toContain('GOAL')
        expect(text).toContain('Fix the typo.')
        expect(text).toContain(rows.accept.label)
        expect(text).toContain(rows.handOver.label)
        expect(text).toContain(rows.close.label)
        expect(hint(panel)).toBe('type to change  ·  ↑↓ pick  ·  enter accept the goal')
    })

    test('enter on an empty input runs the highlighted row', () => {
        panel.setState(state({goal: 'Fix the typo.'}))
        panel.handleInput(enter)
        expect(accept).toHaveBeenCalledTimes(1)

        panel.handleInput(down)
        expect(hint(panel)).toBe('type to change  ·  ↑↓ pick  ·  enter send to main context')
        panel.handleInput(enter)
        expect(handOver).toHaveBeenCalledTimes(1)

        panel.handleInput(up)
        panel.handleInput(up)
        panel.handleInput(enter)
        expect(close).toHaveBeenCalledTimes(1)
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

    test('accepted goal moves the strip and leads with hand over', () => {
        panel.setState(state({goal: 'Fix the typo.', accepted: true}))
        const lines = panel.render(width)
        expect(lines[0]).toBe('✓ Goal   ● Questions   ○ Steps   ○ Hand over')
        expect(lines).toContain('✓ GOAL')
        expect(lines.join('\n')).not.toContain(rows.accept.label)
        panel.handleInput(enter)
        expect(handOver).toHaveBeenCalledTimes(1)
    })

    test('running shows the subagent line, no input, no menu', () => {
        panel.setState(state({goal: 'Old.', running: true, status: 'reading src/greet.js'}))
        const text = panel.render(width).join('\n')
        expect(text).toContain('subagent · reading src/greet.js')
        expect(text).not.toContain('> ')
        expect(text).not.toContain(rows.accept.label)
        expect(hint(panel)).toBe('esc close')
        type(panel, 'x')
        panel.handleInput(enter)
        expect(change).not.toHaveBeenCalled()
        panel.handleInput(escape)
        expect(close).toHaveBeenCalledTimes(1)
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
