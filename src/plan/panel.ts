import type {Theme} from '@earendil-works/pi-coding-agent'
import type {SelectItem, SelectListTheme} from '@earendil-works/pi-tui'
import {Input, Key, matchesKey, SelectList, wrapTextWithAnsi} from '@earendil-works/pi-tui'

import type {Focusable} from '../config/box'
import {spinnerFrames, SubagentRows} from '../subagent/subagentTui'

const steps = ['Goal', 'Questions', 'Steps', 'Hand over'] as const
const escapeKey = Key.escape
const enterKey = Key.enter
const upKey = Key.up
const downKey = Key.down
const maxRows = 4

type PanelState = {
    goal?: string
    accepted: boolean
    running: boolean
    status: string
    error?: string
}

type Action = 'change' | 'accept' | 'handOver' | 'close'
type PanelActions = Record<Action, (text: string) => void>

const rows: Record<Exclude<Action, 'change'>, SelectItem> = {
    accept: {value: 'accept', label: 'Accept the goal'},
    handOver: {value: 'handOver', label: 'Send to main context'},
    close: {value: 'close', label: 'Close'}
}

const menuFor = (state: PanelState): SelectItem[] => {
    if (state.running || state.goal === undefined) return []
    if (state.accepted) return [rows.handOver, rows.close]
    return [rows.accept, rows.handOver, rows.close]
}

const stepStrip = (theme: Theme, current: number): string =>
    steps
        .map((step, index) => {
            if (index < current) return theme.fg('success', `✓ ${step}`)
            if (index === current) return theme.fg('accent', theme.bold(`● ${step}`))
            return theme.fg('dim', `○ ${step}`)
        })
        .join(theme.fg('dim', '   '))

// While the user types, Enter belongs to the input, so the list shows no cursor.
const listTheme = (theme: Theme, active: boolean): SelectListTheme => ({
    selectedPrefix: text => (active ? theme.fg('accent', text) : ' '.repeat(text.length)),
    selectedText: text => (active ? theme.fg('accent', text) : text),
    description: text => theme.fg('muted', text),
    scrollInfo: text => theme.fg('muted', text),
    noMatch: text => theme.fg('muted', text)
})

const body = (theme: Theme, state: PanelState, width: number): string[] => {
    if (state.goal === undefined) return [theme.fg('dim', 'Type what you want done.')]

    const mark = state.accepted ? theme.fg('success', '✓ ') : ''
    return [mark + theme.fg('accent', theme.bold('GOAL')), ...wrapTextWithAnsi(state.goal, width)]
}

class PlanPanel implements Focusable {
    private readonly input = new Input({prompt: '> '})
    private readonly rows: SubagentRows
    private state: PanelState = {accepted: false, running: false, status: ''}
    private selected = 0

    constructor(
        private readonly theme: Theme,
        requestRepaint: () => void,
        private readonly actions: PanelActions
    ) {
        this.rows = new SubagentRows(requestRepaint)
    }

    setState(state: PanelState): void {
        this.state = state
        this.selected = 0
        this.rows.setRunning(state.running)
    }

    render(width: number): string[] {
        const {theme, state} = this
        const status =
            state.running ? [this.spinnerLine(width)]
            : state.error === undefined ? []
            : wrapTextWithAnsi(theme.fg('error', state.error), width)
        const menu = this.menu(width)

        return [
            stepStrip(theme, state.accepted ? 1 : 0),
            '',
            ...body(theme, state, width),
            '',
            ...status,
            ...(status.length === 0 ? [] : ['']),
            ...(state.running ? [] : this.input.render(width)),
            ...(menu.length === 0 ? [] : ['', ...menu]),
            '',
            this.hints()
        ]
    }

    invalidate(): void {
        this.input.invalidate()
    }

    handleInput(data: string): void {
        const menu = menuFor(this.state)
        const typing = this.input.getValue() !== ''

        if (matchesKey(data, escapeKey)) {
            if (typing) this.input.setValue('')
            else this.actions.close('')
        } else if (this.state.running) return
        else if (matchesKey(data, enterKey)) {
            if (typing) this.submit()
            else this.pick(menu)
        } else if (!typing && menu.length > 0 && matchesKey(data, upKey))
            this.selected = (this.selected + menu.length - 1) % menu.length
        else if (!typing && menu.length > 0 && matchesKey(data, downKey))
            this.selected = (this.selected + 1) % menu.length
        else this.input.handleInput(data)
    }

    private submit(): void {
        const text = this.input.getValue().trim()
        this.input.setValue('')
        if (text !== '') this.actions.change(text)
    }

    private pick(menu: SelectItem[]): void {
        const row = menu[this.selected]

        if (row !== undefined) this.actions[row.value as Action]('')
    }

    private menu(width: number): string[] {
        const items = menuFor(this.state)

        if (items.length === 0) return []

        const list = new SelectList(
            items,
            maxRows,
            listTheme(this.theme, this.input.getValue() === '')
        )
        list.setSelectedIndex(this.selected)
        return list.render(width)
    }

    private hints(): string {
        const {theme, state} = this
        const menu = menuFor(state)
        const keys =
            state.running ? ['esc close']
            : this.input.getValue() !== '' ? ['enter sends', 'esc clears']
            : menu.length === 0 ? ['type your request', 'enter sends', 'esc close']
            : [
                    'type to change',
                    '↑↓ pick',
                    `enter ${(menu[this.selected]?.label ?? '').toLowerCase()}`
                ]

        return theme.fg('muted', keys.join('  ·  '))
    }

    private spinnerLine(width: number): string {
        // Rendering the rows keeps their spinner timer alive; only the frame is used here.
        this.rows.render(width)
        return (
            this.theme.fg('accent', spinnerFrames[this.rows.frame] ?? '')
            + ' '
            + this.theme.fg('muted', 'subagent · ')
            + this.theme.fg('toolOutput', this.state.status || 'starting…')
        )
    }
}

export {escapeKey, PlanPanel, rows, steps}
export type {PanelActions, PanelState}
