import {afterEach, describe, expect, test} from 'bun:test'
import type {Theme} from '@earendil-works/pi-coding-agent'
import type {Component} from '@earendil-works/pi-tui'
import {Container, stripTerminalSequences} from '@earendil-works/pi-tui'
import type {SubagentDetails} from '../../src/subagent/subagent'
import type {SubagentRenderState} from '../../src/subagent/subagentTui'
import {
    clockIcon,
    renderCall as renderCallTui,
    renderResult as renderResultTui,
    SubagentRows,
    toolProgress,
    toolUpdate
} from '../../src/subagent/subagentTui'
import {idleTicks, spinnerFrames, spinnerIntervalMs} from '../../src/tui/spinner'

// The tests drive the renderers the way registerSubagentTool does: name and title come from args.
const renderCall = (args: {task?: string} | undefined, theme: Theme, ctx: TestContext) =>
    renderCallTui('subagent', args?.task, theme, ctx as never)
const renderResult = (
    result: Parameters<typeof renderResultTui>[2],
    options: Parameters<typeof renderResultTui>[3],
    theme: Theme,
    ctx: TestContext
) => renderResultTui('subagent', ctx.args?.task, result, options, theme, ctx as never)

const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text
} as unknown as Theme

const details = (over: Partial<SubagentDetails> = {}): SubagentDetails =>
    ({
        sessionFile: undefined,
        sessionId: 'fake',
        userMessages: 1,
        assistantMessages: 12,
        toolCalls: 4,
        toolResults: 4,
        totalMessages: 20,
        tokens: {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15},
        cost: 0,
        contextUsage: {tokens: 10_000, contextWindow: 120_000, percent: 8.3},
        model: 'fake-model',
        provider: 'fake',
        stopReason: 'stop',
        timestamp: new Date(),
        task: 'find the auth flow',
        lastAssistantText: 'Checking src/auth/session.ts',
        elapsedMs: 10_000,
        restarts: 0,
        ...over
    }) as SubagentDetails

type TestContext = {
    args: {task?: string} | undefined
    state: SubagentRenderState
    invalidate: () => void
    isError: boolean
    executionStarted: boolean
}

const contexts: TestContext[] = []

const makeContext = (over: Partial<TestContext> = {}): TestContext => {
    const ctx: TestContext = {
        args: {task: 'find the auth flow'},
        state: {},
        invalidate: () => {},
        isError: false,
        executionStarted: true,
        ...over
    }
    contexts.push(ctx)
    return ctx
}

const stillTicking = async (rows: SubagentRows): Promise<boolean> => {
    const deadline = Date.now() + spinnerIntervalMs * idleTicks * 4

    while (rows.isTicking() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, spinnerIntervalMs))
    }

    return rows.isTicking()
}

const lines = (component: Component, width = 80): string[] =>
    component.render(width).map(line => stripTerminalSequences(line).trimEnd())

const partial = (over: Partial<SubagentDetails> = {}) => ({
    content: [{type: 'text' as const, text: 'partial'}],
    details: details(over)
})

const failure = {
    content: [{type: 'text' as const, text: 'Subagent run failed: boom'}],
    details: undefined
}
afterEach(() => {
    for (const ctx of contexts) ctx.state.rows?.stop()
    contexts.length = 0
})

describe('subagent tui', () => {
    describe('toolProgress turns runner events into pi partial results', () => {
        test('a turn carries its text and details', () => {
            const seen: unknown[] = []
            toolProgress(update => seen.push(update))?.({
                type: 'turn',
                text: 'looking',
                details: details()
            })
            expect(seen).toEqual([{content: [{type: 'text', text: 'looking'}], details: details()}])
        })

        test('the other events carry only a label', () => {
            expect(toolUpdate({type: 'restarting', guard: 'loop'})).toEqual({
                content: [{type: 'text', text: 'restarting: loop'}],
                details: undefined
            })
            expect(toolUpdate({type: 'started'})).toEqual({
                content: [{type: 'text', text: ''}],
                details: undefined
            })
        })

        test('no pi callback means no adapter', () => {
            expect(toolProgress(undefined)).toBeUndefined()
        })
    })

    test('renderCall shows three lines before any progress arrives', () => {
        const out = lines(renderCall({task: 'find the auth flow'}, theme, makeContext() as never))
        expect(out).toHaveLength(3)
        expect(out[0]).toBe(`${spinnerFrames[0]} subagent - find the auth flow`)
        expect(out[1]).toBe('  starting…')
        expect(out[2]).toBe('  TIME 00:00 • TURN 0 • □□□□□□□□□□ ?/?')
    })

    describe('the way pi actually drives the row: renderCall, then renderResult', () => {
        const pass = (
            ctx: TestContext,
            result: Parameters<typeof renderResult>[0],
            options = {expanded: false, isPartial: false}
        ) => {
            const box = new Container()
            box.addChild(renderCall(ctx.args, theme, ctx as never))
            box.addChild(renderResult(result, options, theme, ctx as never))
            return box.render(80).map(line => stripTerminalSequences(line).trimEnd())
        }
        test('draws the block once on a finished run', () => {
            const out = pass(makeContext(), {
                content: [{type: 'text', text: 'done'}],
                details: details()
            })
            expect(out).toHaveLength(3)
            expect(out[0]).toBe('✓ subagent - find the auth flow')
        })

        test('draws the block once on a run that failed before any progress', () => {
            const out = pass(makeContext({isError: true}), failure)
            expect(out).toHaveLength(3)
            expect(out[0]).toContain('✗ subagent')
            expect(out[1]).toBe('  Subagent run failed: boom')
        })

        test('draws the block once while streaming', () => {
            const out = pass(makeContext(), partial(), {expanded: false, isPartial: true})
            expect(out).toHaveLength(3)
        })

        test('draws the block once before any result exists', () => {
            const ctx = makeContext()
            const box = new Container()
            box.addChild(renderCall(ctx.args, theme, ctx as never))

            expect(box.render(80)).toHaveLength(3)
        })
    })

    test('renderCall goes silent once a result has landed', () => {
        const ctx = makeContext()
        renderResult(partial(), {expanded: false, isPartial: true}, theme, ctx as never)

        expect(lines(renderCall(ctx.args, theme, ctx as never))).toHaveLength(0)
    })

    test('running result shows spinner, turn count and context bar', () => {
        const out = lines(
            renderResult(
                partial(),
                {expanded: false, isPartial: true},
                theme,
                makeContext() as never
            )
        )
        expect(out).toHaveLength(3)
        expect(out[1]).toBe('  Checking src/auth/session.ts')
        expect(out[2]).toBe('  TIME 00:10 • TURN 12 • ■□□□□□□□□□ 10/120k')
    })

    test('a restarted run shows the restart count', () => {
        const out = lines(
            renderResult(
                partial({restarts: 2}),
                {expanded: false, isPartial: true},
                theme,
                makeContext() as never
            )
        )
        expect(out[2]).toBe('  TIME 00:10 • TURN 12 • RESTART 2 • ■□□□□□□□□□ 10/120k')
    })

    test('a queued call shows a still clock, no spinner, and holds TIME at zero', async () => {
        const ctx = makeContext()
        lines(renderCall(ctx.args, theme, ctx as never))
        ctx.state.rows!.startedAt = Date.now() - 95_000

        const out = lines(
            renderResult(
                toolUpdate({type: 'queued'}),
                {expanded: false, isPartial: true},
                theme,
                ctx as never
            )
        )
        expect(out[0]).toStartWith(`${clockIcon} subagent`)
        expect(out[1]).toBe('  queued…')
        expect(out[2]).toBe('  TIME 00:00 • TURN 0 • □□□□□□□□□□ ?/?')
        expect(ctx.state.rows!.startedAt).toBeUndefined()
        expect(await stillTicking(ctx.state.rows!)).toBe(false)

        const started = lines(
            renderResult(
                toolUpdate({type: 'started'}),
                {expanded: false, isPartial: true},
                theme,
                ctx as never
            )
        )
        expect(started[0]).toStartWith(`${spinnerFrames[0]} subagent`)
        expect(started[1]).toBe('  starting…')
        expect(started[2]).toContain('TIME 00:00')
        expect(ctx.state.rows!.startedAt).toBeGreaterThan(Date.now() - 1_000)
    })

    test('finished result swaps the spinner for a check and stops the timer', () => {
        const ctx = makeContext()
        lines(renderCall(ctx.args, theme, ctx as never))
        expect(ctx.state.rows?.running).toBe(true)

        const out = lines(
            renderResult(
                {content: [{type: 'text', text: 'done'}], details: details()},
                {expanded: false, isPartial: false},
                theme,
                ctx as never
            )
        )
        expect(out[0]).toBe('✓ subagent - find the auth flow')
        expect(ctx.state.rows?.running).toBe(false)
    })

    describe('a failed run, where pi hands the renderer details: undefined', () => {
        test('keeps the error text instead of showing a bare "failed"', () => {
            const out = lines(
                renderResult(
                    failure,
                    {expanded: false, isPartial: false},
                    theme,
                    makeContext({isError: true}) as never
                )
            )
            expect(out).toHaveLength(3)
            expect(out[0]).toContain('✗ subagent')
            expect(out[1]).toBe('  Subagent run failed: boom')
        })

        test('prefers the error over the last thing the subagent said', () => {
            const ctx = makeContext({isError: true})
            renderResult(partial(), {expanded: false, isPartial: true}, theme, ctx as never)

            const out = lines(
                renderResult(failure, {expanded: false, isPartial: false}, theme, ctx as never)
            )
            expect(out[0]).toContain('✗ subagent')
            expect(out[1]).toBe('  Subagent run failed: boom')
        })

        test('keeps the stats gathered before the failure', () => {
            const ctx = makeContext({isError: true})
            renderResult(partial(), {expanded: false, isPartial: true}, theme, ctx as never)

            const out = lines(
                renderResult(failure, {expanded: false, isPartial: false}, theme, ctx as never)
            )
            expect(out[2]).toBe('  TIME 00:10 • TURN 12 • ■□□□□□□□□□ 10/120k')
        })

        test('does not let renderCall draw a second, still-running block', () => {
            const ctx = makeContext({isError: true})
            renderResult(failure, {expanded: false, isPartial: false}, theme, ctx as never)

            expect(lines(renderCall(ctx.args, theme, ctx as never))).toHaveLength(0)
            expect(ctx.state.rows?.running).toBe(false)
        })

        test('stops the spinner timer', () => {
            const ctx = makeContext({isError: true})
            lines(renderCall(ctx.args, theme, ctx as never))
            renderResult(failure, {expanded: false, isPartial: false}, theme, ctx as never)

            expect(ctx.state.rows?.running).toBe(false)
        })
    })

    test('collapsed view stays three lines, expanded view adds the answer', () => {
        const result = {content: [{type: 'text' as const, text: 'The answer'}], details: details()}
        const collapsed = lines(
            renderResult(result, {expanded: false, isPartial: false}, theme, makeContext() as never)
        )
        const expanded = lines(
            renderResult(result, {expanded: true, isPartial: false}, theme, makeContext() as never)
        )
        expect(collapsed).toHaveLength(3)
        expect(expanded.length).toBeGreaterThan(3)
        expect(expanded.join('\n')).toContain('The answer')
    })

    test('an expanded result with no text stays three lines', () => {
        const out = lines(
            renderResult(
                {content: [{type: 'text', text: '   '}], details: details()},
                {expanded: true, isPartial: false},
                theme,
                makeContext() as never
            )
        )
        expect(out).toHaveLength(3)
    })

    test('every line is truncated to the terminal width', () => {
        const long = 'x'.repeat(500)
        const out = renderResult(
            {content: [{type: 'text', text: long}], details: details({lastAssistantText: long})},
            {expanded: false, isPartial: true},
            theme,
            makeContext({args: {task: long}}) as never
        ).render(40)
        expect(out).toHaveLength(3)
        for (const line of out) expect(stripTerminalSequences(line)).toHaveLength(40)
    })

    test('a markdown code fence does not leak into the status line', () => {
        const out = lines(
            renderResult(
                partial({lastAssistantText: '```sh\nls /tmp\n```'}),
                {expanded: false, isPartial: true},
                theme,
                makeContext() as never
            )
        )
        expect(out[1]).toBe('  ls /tmp')
    })

    test('a truncated row keeps the row background alive', () => {
        const long = 'x'.repeat(500)
        const out = renderResult(
            partial({lastAssistantText: long}),
            {expanded: false, isPartial: true},
            theme,
            makeContext() as never
        ).render(40)

        for (const line of out) expect(line).not.toContain('\u001b[0m')
    })

    test('multi-line assistant text collapses to a single line', () => {
        const out = lines(
            renderResult(
                partial({lastAssistantText: 'first\nsecond\nthird'}),
                {expanded: false, isPartial: true},
                theme,
                makeContext() as never
            )
        )
        expect(out[1]).toBe('  first second third')
    })

    test('a tool-only turn keeps the previous message instead of blanking the line', () => {
        const ctx = makeContext()
        lines(
            renderResult(
                partial({lastAssistantText: 'Checking auth'}),
                {expanded: false, isPartial: true},
                theme,
                ctx as never
            )
        )
        const out = lines(
            renderResult(
                {content: [{type: 'text', text: ''}], details: details({lastAssistantText: ''})},
                {expanded: false, isPartial: true},
                theme,
                ctx as never
            )
        )
        expect(out[1]).toBe('  Checking auth')
    })

    test('a tool-only turn shows working', () => {
        const out = lines(
            renderResult(
                {content: [{type: 'text', text: ''}], details: details({lastAssistantText: ''})},
                {expanded: false, isPartial: true},
                theme,
                makeContext() as never
            )
        )
        expect(out[1]).toBe('  working…')
    })

    test('a missing task still renders the header', () => {
        const out = lines(renderCall(undefined, theme, makeContext({args: undefined}) as never))
        expect(out[0]).toContain('subagent - …')
    })

    test('the clock stays at zero until the subagent actually starts', () => {
        const ctx = makeContext({executionStarted: false})
        const out = lines(renderCall(ctx.args, theme, ctx as never))
        expect(ctx.state.rows!.startedAt).toBeUndefined()
        expect(out[2]).toContain('TIME 00:00')
    })

    test('a run past an hour reports hours', () => {
        const out = lines(
            renderResult(
                {content: [{type: 'text', text: 'done'}], details: details({elapsedMs: 4_530_000})},
                {expanded: false, isPartial: false},
                theme,
                makeContext() as never
            )
        )
        expect(out[2]).toContain('TIME 1:15:30')
    })

    test('the clock keeps moving between progress events', () => {
        const ctx = makeContext()
        lines(renderCall(ctx.args, theme, ctx as never))
        ctx.state.rows!.startedAt = Date.now() - 95_000

        const out = lines(
            renderResult(
                partial({elapsedMs: 3_000}),
                {expanded: false, isPartial: true},
                theme,
                ctx as never
            )
        )
        expect(out[2]).toContain('TIME 01:35')
    })

    test('a failed run reports the live clock, not a stale snapshot', () => {
        const ctx = makeContext({isError: true})
        lines(renderCall(ctx.args, theme, ctx as never))
        ctx.state.details = details({elapsedMs: 2_000})
        ctx.state.rows!.startedAt = Date.now() - 300_000

        const out = lines(
            renderResult(
                {content: [{type: 'text', text: 'boom'}], details: undefined},
                {expanded: false, isPartial: false},
                theme,
                ctx as never
            )
        )
        expect(out[2]).toContain('TIME 05:00')
    })

    test('a finished run reports the duration the runner measured', () => {
        const ctx = makeContext()
        ctx.state.rows = undefined

        const out = lines(
            renderResult(
                {content: [{type: 'text', text: 'done'}], details: details({elapsedMs: 754_000})},
                {expanded: false, isPartial: false},
                theme,
                ctx as never
            )
        )
        expect(out[2]).toContain('TIME 12:34')
    })

    test('an unchanged expanded answer is not re-parsed', () => {
        const ctx = makeContext()
        const result = {content: [{type: 'text' as const, text: '# Answer'}], details: details()}
        const options = {expanded: true, isPartial: false}
        renderResult(result, options, theme, ctx as never)

        const first = ctx.state.body?.markdown
        renderResult(result, options, theme, ctx as never)
        expect(ctx.state.body?.markdown).toBe(first!)

        renderResult(
            {...result, content: [{type: 'text', text: '# Other'}]},
            options,
            theme,
            ctx as never
        )
        expect(ctx.state.body?.markdown).not.toBe(first!)
    })

    test('a settled row keeps returning the same call slot', () => {
        const ctx = makeContext()
        const slot = renderCall(ctx.args, theme, ctx as never)
        renderResult(partial(), {expanded: false, isPartial: false}, theme, ctx as never)

        const again = renderCall(ctx.args, theme, ctx as never)
        expect(again).toBe(slot)
        expect(again.render(80)).toHaveLength(0)
        again.invalidate()
    })

    describe('the context bar', () => {
        const label = (tokens: number | null, contextWindow = 120_000) =>
            lines(
                renderResult(
                    partial({
                        contextUsage: {tokens, contextWindow, percent: null},
                        lastAssistantText: 'x'
                    }),
                    {expanded: false, isPartial: true},
                    theme,
                    makeContext() as never
                )
            )[2]
        test('never jumps backwards as tokens grow', () => {
            expect(label(999)).toContain('1.0/120k')
            expect(label(1500)).toContain('1.5/120k')
            expect(label(9000)).toContain('9.0/120k')
            expect(label(37_000)).toContain('37/120k')
        })

        test('fills proportionally and clamps at full', () => {
            expect(label(0)).toContain('□□□□□□□□□□')
            expect(label(60_000)).toContain('■■■■■□□□□□')
            expect(label(120_000)).toContain('■■■■■■■■■■')
            expect(label(500_000)).toContain('■■■■■■■■■■')
        })

        test('shows nothing rather than a different metric when usage is unknown', () => {
            expect(label(null)).toContain('□□□□□□□□□□ ?/?')
            expect(label(10_000, 0)).toContain('□□□□□□□□□□ ?/?')
        })
    })

    describe('SubagentRows on its own', () => {
        test('pads every row to the viewport width', () => {
            const rows = new SubagentRows(() => {})
            rows.invalidate()
            rows.setRows(['a', 'b', 'c'])
            rows.setRunning(true)
            rows.start()

            expect(rows.render(5)).toEqual(['a    ', 'b    ', 'c    '])

            rows.stop()
            rows.stop()
            expect(rows.isTicking()).toBe(false)
        })

        test('asks for a repaint on every tick', async () => {
            let repaints = 0
            const rows = new SubagentRows(() => repaints++)
            rows.setRunning(true)
            rows.start()
            await new Promise(resolve => setTimeout(resolve, spinnerIntervalMs * 2))
            rows.stop()

            expect(rows.frame).toBeGreaterThan(0)
            expect(repaints).toBe(rows.frame)
        })
    })

    describe('the spinner timer', () => {
        test('advances the frame and asks for a redraw', async () => {
            let redraws = 0
            const ctx = makeContext({invalidate: () => redraws++})
            lines(renderCall(ctx.args, theme, ctx as never))

            await new Promise(resolve => setTimeout(resolve, spinnerIntervalMs * 3))

            expect(redraws).toBeGreaterThan(0)
            expect(ctx.state.rows!.frame).toBeGreaterThan(0)
        })

        test('parks itself even though its own repaint invalidates the row', async () => {
            const rows: SubagentRows = new SubagentRows(() => rows.invalidate())
            rows.setRunning(true)
            rows.start()

            expect(await stillTicking(rows)).toBe(false)
        })

        test('parks itself when the row stops being rendered', async () => {
            const ctx = makeContext()
            lines(renderCall(ctx.args, theme, ctx as never))

            const rows = ctx.state.rows!
            rows.start()

            expect(await stillTicking(rows)).toBe(false)
        })

        test('restarts when the row is rendered again', async () => {
            const ctx = makeContext()
            const rows = renderCall(ctx.args, theme, ctx as never)
            lines(rows)
            ctx.state.rows!.stop()
            expect(ctx.state.rows!.isTicking()).toBe(false)

            lines(rows)
            expect(ctx.state.rows!.isTicking()).toBe(true)
        })
    })
})
