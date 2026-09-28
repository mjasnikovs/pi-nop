import type {Theme} from '@earendil-works/pi-coding-agent'
import {getSelectListTheme} from '@earendil-works/pi-coding-agent'
import type {SelectItem, SelectListTheme} from '@earendil-works/pi-tui'
import {Input, Key, matchesKey, SelectList, wrapTextWithAnsi} from '@earendil-works/pi-tui'

import type {Focusable} from '../config/box'
import {formatElapsed, Spinner, spinnerFrames} from '../tui/spinner'

const steps = ['Goal', 'Questions', 'Steps', 'Hand over'] as const
const escapeKey = Key.escape
const enterKey = Key.enter
const upKey = Key.up
const downKey = Key.down
const maxRows = 4

type PanelState = {
    request?: string
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

// While the user types, Enter belongs to the input, so the selected row loses its highlight.
const listTheme = (active: boolean): SelectListTheme => {
    const theme = getSelectListTheme()

    if (active) return theme
    return {...theme, selectedText: text => text}
}

const body = (theme: Theme, state: PanelState, width: number): string[] => {
    if (state.goal === undefined) {
        if (state.request === undefined) return [theme.fg('dim', 'Type what you want done.')]
        return [
            theme.fg('accent', theme.bold('REQUEST')),
            ...wrapTextWithAnsi(state.request, width)
        ]
    }

    const mark = state.accepted ? theme.fg('success', '✓ ') : ''
    return [mark + theme.fg('accent', theme.bold('GOAL')), ...wrapTextWithAnsi(state.goal, width)]
}

class PlanPanel implements Focusable {
    private readonly input = new Input({prompt: '> '})
    private readonly spinner: Spinner
    private state: PanelState = {accepted: false, running: false, status: ''}
    private selected = 0

    constructor(
        private readonly theme: Theme,
        requestRepaint: () => void,
        private readonly actions: PanelActions
    ) {
        this.spinner = new Spinner(requestRepaint)
    }

    setState(state: PanelState): void {
        if (state.running && !this.state.running) this.spinner.startedAt = Date.now()

        if (!state.running) {
            this.spinner.startedAt = undefined
            this.spinner.stop()
        }

        this.state = state
        this.selected = 0
    }

    render(width: number): string[] {
        const {theme, state} = this
        const status = this.status(width)
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

        const list = new SelectList(items, maxRows, listTheme(this.input.getValue() === ''))
        list.setSelectedIndex(this.selected)
        return list.render(width)
    }

    private hints(): string {
        const {theme, state} = this
        const menu = menuFor(state)

        return theme.fg('muted', this.hintKeys(menu).join('  ·  '))
    }

    private hintKeys(menu: SelectItem[]): string[] {
        if (this.state.running) return ['esc close']
        if (this.input.getValue() !== '') return ['enter sends', 'esc clears']
        if (menu.length === 0) return ['type your request', 'enter sends', 'esc close']
        return [
            'type to change',
            '↑↓ pick',
            `enter ${(menu[this.selected]?.label ?? '').toLowerCase()}`
        ]
    }

    private status(width: number): string[] {
        const {theme, state} = this

        if (state.running) return [this.spinnerLine()]
        if (state.error === undefined) return []
        return wrapTextWithAnsi(theme.fg('error', state.error), width)
    }

    private spinnerLine(): string {
        this.spinner.painted()
        this.spinner.start()
        return (
            this.theme.fg('accent', spinnerFrames[this.spinner.frame] ?? '')
            + ' '
            + this.theme.fg('muted', `subagent · ${formatElapsed(this.spinner.elapsedMs())} · `)
            + this.theme.fg('toolOutput', this.state.status || 'starting…')
        )
    }
}

export {escapeKey, PlanPanel, rows, steps}
export type {PanelActions, PanelState}
