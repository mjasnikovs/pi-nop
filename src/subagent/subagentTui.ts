import {
    type AgentToolResult,
    getMarkdownTheme,
    type Theme,
    type ToolDefinition,
    type ToolRenderResultOptions
} from '@earendil-works/pi-coding-agent'
import type {TSchema} from 'typebox'
import type {Component} from '@earendil-works/pi-tui'
import {Container, Markdown, Spacer, Text, truncateToWidth} from '@earendil-works/pi-tui'

import type {SubagentDetails} from './subagent'

type SubagentPhase = 'queued' | 'running' | 'done' | 'error'

type SubagentToolResult = AgentToolResult<SubagentDetails | undefined>

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const queued = 'queued…'
const clockIcon = '◷'
const spinnerIntervalMs = 100
const idleTicks = 20
const barWidth = 10
const barFilled = '■'
const barEmpty = '□'
const gutter = '  '
const fullReset = '\u001b[0m'
const softReset = '\u001b[39m\u001b[22m'
const codeFence = /```[a-zA-Z0-9]*/g

class SubagentRows implements Component {
    private rows: [string, string, string] = ['', '', '']
    private timer: ReturnType<typeof setInterval> | undefined
    private missedTicks = 0

    frame = 0
    running = false
    startedAt: number | undefined

    constructor(private readonly requestRepaint: () => void) {}

    setRows(rows: [string, string, string]) {
        this.rows = rows
    }

    setRunning(running: boolean) {
        this.running = running

        if (!running) this.stop()
    }

    render(width: number): string[] {
        this.missedTicks = 0

        if (this.running) this.start()
        return this.rows.map(row =>
            truncateToWidth(row, Math.max(1, width), '', true).replaceAll(fullReset, softReset)
        )
    }

    invalidate() {}

    elapsedMs(): number {
        if (this.startedAt === undefined) return 0
        return Date.now() - this.startedAt
    }

    start() {
        if (this.timer !== undefined) return

        const timer = setInterval(() => {
            this.missedTicks += 1

            if (this.missedTicks > idleTicks) {
                this.stop()
                return
            }

            this.frame = (this.frame + 1) % spinnerFrames.length
            this.requestRepaint()
        }, spinnerIntervalMs)
        timer.unref?.()
        this.timer = timer
    }

    isTicking(): boolean {
        return this.timer !== undefined
    }

    stop() {
        if (this.timer === undefined) return

        clearInterval(this.timer)
        this.timer = undefined
    }
}

class CallSlot implements Component {
    constructor(
        private readonly state: SubagentRenderState,
        private readonly rows: SubagentRows
    ) {}

    render(width: number): string[] {
        return this.state.settled ? [] : this.rows.render(width)
    }

    invalidate() {
        this.rows.invalidate()
    }
}

type SubagentRenderState = {
    rows?: SubagentRows
    call?: CallSlot
    body?: {text: string; markdown: Markdown}
    expanded?: {container: Container; spacer: Spacer; error: Text}
    settled?: boolean
    details?: SubagentDetails
}

type SubagentTool = ToolDefinition<TSchema, SubagentDetails, SubagentRenderState>

type SubagentRenderContext = Parameters<NonNullable<SubagentTool['renderCall']>>[2] & {
    state: SubagentRenderState
}

const rowsFor = (ctx: SubagentRenderContext): SubagentRows => {
    const rows = (ctx.state.rows ??= new SubagentRows(ctx.invalidate))

    if (ctx.executionStarted && rows.startedAt === undefined) rows.startedAt = Date.now()
    return rows
}

const formatElapsed = (elapsedMs: number): string => {
    const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const clock = `${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

    if (hours === 0) return clock
    return `${String(hours)}:${clock}`
}

const formatK = (tokens: number): string =>
    tokens >= 9950 ? String(Math.round(tokens / 1000)) : (tokens / 1000).toFixed(1)

const formatContext = (details: SubagentDetails | undefined): {bar: string; label: string} => {
    const usage = details?.contextUsage
    const tokens = usage?.tokens ?? null
    const window = usage?.contextWindow ?? 0

    if (tokens === null || window <= 0) return {bar: barEmpty.repeat(barWidth), label: '?/?'}

    const ratio = Math.min(1, Math.max(0, tokens / window))
    const filled = Math.round(ratio * barWidth)

    return {
        bar: barFilled.repeat(filled) + barEmpty.repeat(barWidth - filled),
        label: `${formatK(tokens)}/${formatK(window)}k`
    }
}

const statusIcon = (theme: Theme, phase: SubagentPhase, frame: number): string => {
    if (phase === 'queued') return theme.fg('muted', clockIcon)
    if (phase === 'running') return theme.fg('accent', spinnerFrames[frame])
    if (phase === 'error') return theme.fg('error', '✗')
    return theme.fg('success', '✓')
}

const oneLine = (text: string | undefined): string =>
    (text ?? '').replace(codeFence, ' ').replace(/\s+/g, ' ').trim()

const firstText = (result: SubagentToolResult): string => {
    const part = result.content.find(item => item.type === 'text')

    return part === undefined ? '' : part.text
}

// A turn of only tool calls has no text, but it proves the run is past starting.
const idleMessage = (details: SubagentDetails | undefined): string =>
    details === undefined ? 'starting…' : 'working…'

const statusMessage = (
    details: SubagentDetails | undefined,
    phase: SubagentPhase,
    fallbackMessage: string
): string =>
    phase === 'error' ?
        oneLine(fallbackMessage) || oneLine(details?.lastAssistantText) || 'failed'
    :   oneLine(details?.lastAssistantText) || oneLine(fallbackMessage) || idleMessage(details)

const phaseFor = (
    options: ToolRenderResultOptions,
    isError: boolean,
    text: string
): SubagentPhase => {
    if (options.isPartial) return text === queued ? 'queued' : 'running'
    if (isError) return 'error'
    return 'done'
}

const restartsLabel = (theme: Theme, restarts: number): string =>
    restarts === 0 ? '' : theme.fg('muted', ' • RESTART ') + theme.fg('dim', String(restarts))

const buildRows = (
    name: string,
    title: string | undefined,
    details: SubagentDetails | undefined,
    phase: SubagentPhase,
    fallbackMessage: string,
    theme: Theme,
    rows: SubagentRows
): [string, string, string] => {
    const {bar, label} = formatContext(details)
    const liveMs = rows.elapsedMs()
    const elapsedMs = Math.max(liveMs, details?.elapsedMs ?? 0)
    const message = statusMessage(details, phase, fallbackMessage)

    return [
        `${statusIcon(theme, phase, rows.frame)} `
            + theme.fg('toolTitle', theme.bold(name))
            + theme.fg('muted', ' - ')
            + theme.fg('dim', oneLine(title) || '…'),
        gutter + theme.fg(phase === 'error' ? 'error' : 'toolOutput', message),
        gutter
            + theme.fg('muted', 'TIME ')
            + theme.fg('dim', formatElapsed(elapsedMs))
            + theme.fg('muted', ' • TURN ')
            + theme.fg('dim', String(details?.assistantMessages ?? 0))
            + restartsLabel(theme, details?.restarts ?? 0)
            + theme.fg('muted', ' • ')
            + theme.fg('accent', bar)
            + ' '
            + theme.fg('dim', label)
    ]
}

const markdownFor = (state: SubagentRenderState, text: string): Markdown => {
    const cached = state.body

    if (cached !== undefined && cached.text === text) return cached.markdown

    const markdown = new Markdown(text, 0, 0, getMarkdownTheme())
    state.body = {text, markdown}
    return markdown
}

const renderCall = (
    name: string,
    title: string | undefined,
    theme: Theme,
    ctx: SubagentRenderContext
): Component => {
    const rows = rowsFor(ctx)

    if (!ctx.state.settled) {
        rows.setRunning(true)
        rows.setRows(buildRows(name, title, undefined, 'running', '', theme, rows))
    }

    return (ctx.state.call ??= new CallSlot(ctx.state, rows))
}

const renderResult = (
    name: string,
    title: string | undefined,
    result: SubagentToolResult,
    options: ToolRenderResultOptions,
    theme: Theme,
    ctx: SubagentRenderContext
): Component => {
    const rows = rowsFor(ctx)
    ctx.state.settled = true

    if (result.details !== undefined)
        ctx.state.details = {
            ...result.details,
            lastAssistantText:
                result.details.lastAssistantText || (ctx.state.details?.lastAssistantText ?? '')
        }

    const text = firstText(result)
    const phase = phaseFor(options, ctx.isError, text)
    // Waiting for a slot is not run time, so the clock restarts once the run begins.
    if (phase === 'queued') rows.startedAt = undefined
    rows.setRunning(phase === 'running')
    rows.setRows(
        buildRows(
            name,
            title ?? ctx.state.details?.task,
            ctx.state.details,
            phase,
            text,
            theme,
            rows
        )
    )

    if (phase === 'running' || !options.expanded || text.trim() === '') return rows

    const expanded = (ctx.state.expanded ??= {
        container: new Container(),
        spacer: new Spacer(1),
        error: new Text('', 0, 0)
    })
    expanded.error.setText(theme.fg('error', text))
    expanded.container.clear()
    expanded.container.addChild(rows)
    expanded.container.addChild(expanded.spacer)
    expanded.container.addChild(
        phase === 'error' ? expanded.error : markdownFor(ctx.state, text.trim())
    )
    return expanded.container
}

export {
    CallSlot,
    clockIcon,
    formatElapsed,
    idleTicks,
    oneLine,
    queued,
    renderCall,
    renderResult,
    spinnerFrames,
    spinnerIntervalMs,
    SubagentRows
}
export type {SubagentRenderState}
