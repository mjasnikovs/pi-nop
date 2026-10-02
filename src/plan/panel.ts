import type {Theme} from '@earendil-works/pi-coding-agent'
import {getSelectListTheme} from '@earendil-works/pi-coding-agent'
import type {SelectItem, SelectListTheme} from '@earendil-works/pi-tui'
import {
    Input,
    Key,
    matchesKey,
    SelectList,
    stripTerminalSequences,
    truncateToWidth,
    wrapTextWithAnsi
} from '@earendil-works/pi-tui'

import type {Focusable} from '../config/box'
import {oneLine} from '../subagent/subagentTui'
import {formatElapsed, Spinner, spinnerFrames} from '../tui/spinner'
import type {Decision, Question} from './ask'

const steps = ['Goal', 'Questions', 'Steps', 'Hand over'] as const
const escapeKey = Key.escape
const enterKey = Key.enter
const upKey = Key.up
const downKey = Key.down

type PanelState = {
    request?: string
    goal?: string
    accepted: boolean
    asked: boolean
    decisions: Decision[]
    question?: Question
    running: boolean
    status: string
    error?: string
}

type Action =
    | 'change'
    | 'accept'
    | 'answer'
    | 'ask'
    | 'finish'
    | 'changeGoal'
    | 'handOver'
    | 'close'
    | 'leave'
type PanelActions = Record<Action, (text: string) => void>
type Row = SelectItem & {action: Action; text: string}

const row = (action: Action, label: string): Row => ({value: action, label, action, text: ''})
const rows = {
    accept: row('accept', 'Accept the goal'),
    ask: row('ask', 'Ask questions'),
    finish: row('finish', 'Finish questions'),
    changeGoal: row('changeGoal', 'Change goal'),
    handOver: row('handOver', 'Send to main context'),
    close: row('close', 'Close')
}

const shown = (text: string): string => stripTerminalSequences(text)
const numbered = (text: string, index: number): string => `${String(index + 1)}. ${text}`

const optionRows = (question: Question): Row[] =>
    question.options.map((option, index) => ({
        value: `option-${String(index)}`,
        label: numbered(oneLine(shown(option)), index),
        action: 'answer',
        text: option
    }))

const menuFor = (state: PanelState): Row[] => {
    if (state.running || state.goal === undefined) return []
    if (state.question !== undefined)
        return [...optionRows(state.question), rows.finish, rows.changeGoal, rows.close]
    if (!state.accepted) return [rows.accept, rows.handOver, rows.close]
    if (state.asked) return [rows.handOver, rows.changeGoal, rows.close]
    return [rows.ask, rows.handOver, rows.changeGoal, rows.close]
}

// A list that scrolls shows at least one row and pi-tui's position line under it.
const scrolling = 2

const sharedInOrder = (room: number, lists: string[][]): string[][] => {
    let left = room

    return lists.map(list => {
        const kept = list.slice(0, left)
        left -= kept.length
        return kept
    })
}

// After accept, typed text is only ever the answer to the question on screen.
const takesText = (state: PanelState): boolean =>
    !state.running && (!state.accepted || state.question !== undefined)

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

// What the body gives up to fit the screen. Each step keeps the cuts of the one before it.
type Compact = {answers: boolean; goal: boolean; options: boolean}
const tightest: Compact = {answers: true, goal: true, options: true}
const compactSteps: Compact[] = [
    {answers: false, goal: false, options: false},
    {answers: true, goal: false, options: false},
    {answers: true, goal: true, options: false},
    tightest
]

const body = (theme: Theme, state: PanelState, width: number, compact: Compact): string[] => {
    if (state.goal === undefined) {
        if (state.request === undefined) return [theme.fg('dim', 'Type what you want done.')]
        return [
            theme.fg('accent', theme.bold('REQUEST')),
            ...wrapTextWithAnsi(state.request, width)
        ]
    }

    const mark = state.accepted ? theme.fg('success', '✓ ') : ''
    const title = mark + theme.fg('accent', theme.bold('GOAL'))
    const goal =
        compact.goal ?
            [truncateToWidth(`${title}  ${oneLine(state.goal)}`, width, '…')]
        :   [title, ...wrapTextWithAnsi(state.goal, width)]

    return [
        ...goal,
        ...answered(theme, state.decisions, width, compact.answers),
        ...asking(theme, state.question, width, compact.options)
    ]
}

const answered = (
    theme: Theme,
    decisions: Decision[],
    width: number,
    counted: boolean
): string[] => {
    if (counted && decisions.length > 0)
        return [theme.fg('success', '✓ ') + `Answered questions: ${String(decisions.length)}`]
    return decisions.flatMap(({question, answer}) => [
        '',
        ...wrapTextWithAnsi(theme.fg('muted', shown(question)), width),
        ...wrapTextWithAnsi(theme.fg('success', '✓ ') + shown(answer), width)
    ])
}

const optionTexts = (question: Question, width: number): string[][] =>
    question.options.map((option, index) => wrapTextWithAnsi(numbered(shown(option), index), width))

type Asked = {heading: string[]; text: string[]; source: string[]}
const nothingAsked: Asked = {heading: [], text: [], source: []}

const asked = (theme: Theme, question: Question | undefined, width: number): Asked => {
    if (question === undefined) return nothingAsked

    const {evidence} = question
    const quote =
        evidence === undefined ?
            []
        :   [theme.fg('dim', `${shown(evidence.file)}: ${shown(evidence.line).trim()}`)]

    return {
        heading: [theme.fg('accent', theme.bold('QUESTION'))],
        text: wrapTextWithAnsi(shown(question.question), width),
        source: quote.flatMap(line => wrapTextWithAnsi(line, width))
    }
}

const asking = (
    theme: Theme,
    question: Question | undefined,
    width: number,
    bare: boolean
): string[] => {
    if (question === undefined) return []

    const {heading, text, source} = asked(theme, question, width)
    return [
        '',
        ...heading,
        ...text,
        ...source,
        ...(bare ? [] : optionTexts(question, width).flat())
    ]
}

class PlanPanel implements Focusable {
    private readonly input = new Input({prompt: '> '})
    private readonly spinner: Spinner
    private state: PanelState = {
        accepted: false,
        asked: false,
        decisions: [],
        running: false,
        status: ''
    }
    private selected = 0

    constructor(
        private readonly theme: Theme,
        requestRepaint: () => void,
        private readonly actions: PanelActions,
        // pi cuts an overlay at the bottom and never says how tall it may be.
        private readonly maxLines: () => number
    ) {
        this.spinner = new Spinner(requestRepaint)
    }

    setState(state: PanelState): void {
        if (state.running && !this.state.running) this.spinner.startedAt = Date.now()

        if (!state.running) {
            this.spinner.startedAt = undefined
            this.spinner.stop()
        }

        // Text typed for a question that left the screen must not turn into a goal change.
        if (!takesText(state) || state.question !== this.state.question) this.input.setValue('')

        this.state = state
        this.selected = 0
    }

    render(width: number): string[] {
        const limit = this.maxLines()
        const hints = ['', ...wrapTextWithAnsi(this.hints(), width)]
        const controls = this.controls(width, limit - hints.length)
        const picked = this.picked(width)

        for (const compact of compactSteps) {
            const pane = compact.options ? picked.padded : []
            const lines = [...this.head(width, compact), ...controls, ...pane, ...hints]
            if (lines.length <= limit) return lines
        }

        return [...this.squeezed(width, limit - hints.length, picked.padded), ...hints]
    }

    // Nothing fits, so the menu may scroll to leave the question text its room.
    private squeezed(width: number, room: number, picked: string[]): string[] {
        const {theme, state} = this
        const {heading, text, source} = asked(theme, state.question, width)
        const controls = this.controls(width, room - text.length)
        const kept = sharedInOrder(Math.max(0, room - controls.length), [
            text,
            source,
            heading,
            picked,
            ['']
        ])
        const [words, quote, title, option, gap] = kept
        const divider = title.length === 0 ? [] : ['']
        const spare = room - controls.length - kept.flat().length - divider.length
        const context = this.head(width, tightest, {...state, question: undefined}).slice(0, -1)
        const above = spare > 0 ? [...context.slice(-spare), ...divider] : []

        return [...above, ...title, ...words, ...quote, ...gap, ...controls, ...option]
    }

    private head(width: number, compact: Compact, state = this.state): string[] {
        return [
            stepStrip(this.theme, state.accepted ? 1 : 0),
            '',
            ...body(this.theme, state, width, compact),
            ''
        ]
    }

    private controls(width: number, room: number): string[] {
        const input = takesText(this.state) ? this.input.render(width) : []
        const gap = input.length === 0 ? [] : ['']
        const rowCount = menuFor(this.state).length
        const status = this.status(width, room - input.length - gap.length - rowCount - 1)
        const above = [...status, ...(status.length === 0 ? [] : ['']), ...input]
        const menu = this.menu(width, room - above.length - gap.length)

        return [...above, ...(menu.length === 0 ? [] : [...gap, ...menu])]
    }

    // padded is as tall as the tallest option, so the rows above do not jump between options.
    private picked(width: number): {text: string[]; padded: string[]} {
        const {question} = this.state
        const texts = question === undefined ? [] : optionTexts(question, width)
        const text = texts[this.selected] ?? []
        const tallest = Math.max(0, ...texts.map(lines => lines.length))

        return {
            text,
            padded: [...text, ...Array.from({length: tallest - text.length}, () => '')]
        }
    }

    invalidate(): void {
        this.input.invalidate()
    }

    handleInput(data: string): void {
        const menu = menuFor(this.state)
        const typing = this.input.getValue() !== ''

        if (matchesKey(data, escapeKey)) {
            if (typing) this.input.setValue('')
            else this.actions.leave('')
        } else if (this.state.running) return
        else if (matchesKey(data, enterKey)) {
            if (typing) this.submit()
            else this.pick(menu)
        } else if (!typing && menu.length > 0 && matchesKey(data, upKey))
            this.selected = (this.selected + menu.length - 1) % menu.length
        else if (!typing && menu.length > 0 && matchesKey(data, downKey))
            this.selected = (this.selected + 1) % menu.length
        else if (takesText(this.state)) this.input.handleInput(data)
    }

    private submit(): void {
        const text = this.input.getValue().trim()
        this.input.setValue('')
        if (text === '') return
        if (this.state.question === undefined) this.actions.change(text)
        else this.actions.answer(text)
    }

    private pick(menu: Row[]): void {
        const picked = menu[this.selected]

        if (picked !== undefined) this.actions[picked.action](picked.text)
    }

    private menu(width: number, room: number): string[] {
        const items = menuFor(this.state)

        if (items.length === 0) return []

        const visible = items.length <= room ? items.length : Math.max(1, room - scrolling + 1)
        const list = new SelectList(items, visible, listTheme(this.input.getValue() === ''))
        list.setSelectedIndex(this.selected)
        return list.render(width)
    }

    private hints(): string {
        const {theme, state} = this
        const menu = menuFor(state)

        return theme.fg('muted', this.hintKeys(menu).join('  ·  '))
    }

    private hintKeys(menu: Row[]): string[] {
        if (this.state.running) return ['esc close']
        if (this.input.getValue() !== '') return ['enter sends', 'esc clears']
        if (menu.length === 0) return ['type your request', 'enter sends', 'esc close']

        const enter = this.enterHint(menu[this.selected])

        if (!takesText(this.state)) return ['↑↓ pick', enter, 'esc close']
        return [this.typeHint(), '↑↓ pick', enter, 'esc close']
    }

    private enterHint(picked: Row | undefined): string {
        if (picked?.action === 'answer') return `enter answer ${String(this.selected + 1)}`
        return `enter ${(picked?.label ?? '').toLowerCase()}`
    }

    private typeHint(): string {
        return this.state.question === undefined ? 'type to change' : 'type your answer'
    }

    private status(width: number, room: number): string[] {
        const {theme, state} = this

        if (state.running) return [this.spinnerLine()]
        if (state.error === undefined) return []
        return wrapTextWithAnsi(theme.fg('error', state.error), width).slice(0, Math.max(1, room))
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
