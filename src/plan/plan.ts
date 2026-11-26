import type {
    CustomEntry,
    ExtensionAPI,
    ExtensionContext,
    SessionEntry
} from '@earendil-works/pi-coding-agent'
import type {OverlayHandle} from '@earendil-works/pi-tui'
import Value from 'typebox/value'

import {boxed, frameRows} from '../config/box'
import {modelSpec} from '../config/config'
import {configuredOptions, subagentSession} from '../subagent/subagent'
import type {SubagentSession, SubagentUpdate} from '../subagent/subagent'
import {progressLabel} from '../subagent/progress'
import {oneLine} from '../subagent/subagentTui'
import {whileHidden} from '../tui/hidden'
import {askTool, askToolName, handOverMessage, planHead, questionsTask, sameQuestion} from './ask'
import type {AskHost, Decision, Question} from './ask'
import {goalPrompt, goalTask, parseGoal, sendBackGoal} from './goal'
import {PlanPanel} from './panel'
import type {PanelActions, PanelState} from './panel'
import {editText, misplaced, parseSteps, sendBackSteps, stepsTask, stepsText} from './steps'
import type {PlanFile, Steps} from './steps'
import {diskTools, progress, stamps, statusText, writes} from './track'
import type {Progress} from './track'

const entryType = 'plan-mode'
const statusKey = 'plan'
const title = 'PLAN'
const noGoalLine = 'The subagent gave no GOAL line. Send your text again or reword it.'
const noStepsLine = 'The subagent gave no steps that pass the checks.'
const tuiOnly = 'Plan mode needs the interactive UI.'
// No maxHeight: pi would cut the rows and the input off the bottom. The panel fits itself.
const overlayOptions = {width: '80%'} as const
const closeTitle = 'Close plan? A running subagent stops.'
const keepLabel = 'Keep planning'
const stopLabel = 'Close and stop'
const editTitle = 'Edit plan'
const layoutTitle =
    'Edit plan: keep STEPS:, FILES:, VERIFY: with 1. <step>, - <path> (existing|new), - <command>'
const misplacedTitles: Record<PlanFile['state'], (path: string) => string> = {
    existing: path => `Edit plan: ${path} is tagged existing but is not a file on disk`,
    new: path => `Edit plan: ${path} is tagged new but is on disk`
}

type PlanState = Steps & {
    request?: string
    goal?: string
    accepted: boolean
    decisions: Decision[]
    /** The questions step ran to its end or the user finished it. */
    asked: boolean
    /** The plan went to the main agent and its files are tracked. */
    handed: boolean
    /** What each FILES row was on disk at hand over. */
    disk?: string[]
    /** Typed steps changes. The goal predates them, so hand over sends them too. */
    changes: string[]
}

/** What the session was opened with, so a settings change opens a fresh one. */
type Opened = {model?: string; thinkingLevel?: string}

type Run = {
    request: string
    typed?: string
    status: string
    turns: number
    controller: AbortController
    questions: boolean
    askedThisTurn: boolean
    waiting?: {question: Question; answer: (text: string) => void}
}

const checkEdit = async (
    cwd: string,
    saved: Steps,
    text: string
): Promise<{plan: Steps} | {reason: string} | 'unchanged'> => {
    const plan = parseSteps(text)

    if (plan === undefined) return {reason: layoutTitle}
    // Before the disk check: a file made since planning must not refuse a plan left as it was.
    if (Value.Equal(plan, {steps: saved.steps, files: saved.files, verify: saved.verify}))
        return 'unchanged'

    const wrong = await misplaced(cwd, plan.files, undefined)
    return wrong === undefined ? {plan} : {reason: misplacedTitles[wrong.state](wrong.path)}
}

const idle: PlanState = {
    accepted: false,
    decisions: [],
    asked: false,
    handed: false,
    changes: [],
    steps: [],
    files: [],
    verify: []
}

// The goal prompt allows no text before the answer, so tool turns report only their count.
const runStatus = (text: string, turns: number): string => {
    if (turns === 0) return oneLine(text)
    return oneLine(text) || `turn ${String(turns)}`
}

const isPlanEntry = (entry: SessionEntry): entry is CustomEntry<PlanState> =>
    entry.type === 'custom' && entry.customType === entryType

// An entry saved before a later step was built lacks that step's fields.
const lastPlan = (ctx: ExtensionContext): {state: PlanState; after: SessionEntry[]} => {
    const branch = ctx.sessionManager.getBranch()
    const at = branch.findLastIndex(entry => isPlanEntry(entry) && entry.data !== undefined)
    const saved = branch[at]

    if (saved === undefined || !isPlanEntry(saved)) return {state: idle, after: []}
    return {state: {...idle, ...saved.data}, after: branch.slice(at + 1)}
}

export default function (pi: ExtensionAPI) {
    let state = idle
    let running: Run | undefined
    let error: string | undefined
    let subagent: {session: SubagentSession; knowsGoal: boolean; opened: Opened} | undefined
    let repaint: (() => void) | undefined
    let tracked: Progress | undefined
    let failedText: string | undefined
    let trackRuns = 0

    // The only place panel state comes from, so a new field cannot miss a copy.
    const panelState = (): PanelState => ({
        request: state.request ?? running?.request ?? failedText,
        goal: state.goal,
        accepted: state.accepted,
        asked: state.asked,
        decisions: state.decisions,
        steps: state.steps,
        files: state.files,
        verify: state.verify,
        handed: state.handed,
        progress: tracked,
        question: running?.waiting?.question,
        running: running !== undefined && running.waiting === undefined,
        status: running?.status ?? '',
        error,
        failedText
    })

    const save = (next: PlanState): void => {
        failedText = undefined
        state = next
        pi.appendEntry(entryType, state)
    }

    const track = async (ctx: ExtensionContext): Promise<void> => {
        trackRuns += 1
        const run = trackRuns
        const next =
            state.handed ?
                await progress(ctx.cwd, state, writes(lastPlan(ctx).after), state.disk)
            :   undefined

        if (run !== trackRuns) return
        tracked = next

        // A reload or a new session while the paths resolved leaves a ctx that throws.
        try {
            ctx.ui.setStatus(statusKey, next === undefined ? undefined : statusText(next))
        } catch {
            return
        }

        repaint?.()
    }

    const handOver = async (ctx: ExtensionContext): Promise<void> => {
        const plan = state
        const {goal, decisions} = plan
        const message = handOverMessage(goal ?? '', decisions, stepsText(plan), plan.changes)
        const disk = await stamps(ctx.cwd, plan)

        // A new request or a tree move while the stamps were read replaced this plan.
        if (state !== plan) return

        // A reload while the stamps were read leaves a pi that throws.
        try {
            save(plan.steps.length > 0 ? {...plan, handed: true, disk} : idle)
            // Without deliverAs pi refuses a message while the main agent is busy.
            if (goal !== undefined) pi.sendUserMessage(message, {deliverAs: 'followUp'})
        } catch {
            return
        }

        void track(ctx)
    }

    const saveEdit = (opened: PlanState, plan: Steps): void => {
        // A restore while the edit was open replaced this plan.
        if (state !== opened) return

        closeSubagent()

        // A reload while the files were checked leaves a pi that throws.
        try {
            save({...state, ...plan})
        } catch {
            return
        }

        repaint?.()
    }

    const stopRun = (): void => {
        running?.controller.abort()
        running = undefined
        error = undefined
    }

    const closeSubagent = (): void => {
        stopRun()
        subagent?.session.dispose()
        subagent = undefined
    }

    const taskFor = (text: string): string => {
        if (state.request === undefined) return goalTask({request: text})
        if (subagent?.knowsGoal === true) return goalTask({change: text})
        return goalTask({request: state.request, goal: state.goal, change: text})
    }

    const askHost = (cwd: string): AskHost => ({
        cwd,
        open: () => running?.questions === true,
        claim: () => {
            if (running?.askedThisTurn !== false) return false
            running.askedThisTurn = true
            return true
        },
        stored: question =>
            state.decisions.find(decision => sameQuestion(decision.question, question))?.answer,
        show: (question, reply) => {
            const waiting = {question, answer: reply}
            if (running !== undefined) running.waiting = waiting
            repaint?.()
            return () => {
                if (running?.waiting !== waiting) return
                running.waiting = undefined
                repaint?.()
            }
        }
    })

    // The tool is in the session from its first turn: a tool change empties the cache, and the
    // steps turn pays that once.
    const openSubagent = (
        ctx: ExtensionContext
    ): {session: SubagentSession; knowsGoal: boolean} => {
        const options = configuredOptions(ctx, 'subagent')
        const opened = {
            model: options.model === undefined ? undefined : modelSpec(options.model),
            thinkingLevel: options.thinkingLevel
        }

        if (subagent !== undefined && !Value.Equal(subagent.opened, opened)) closeSubagent()

        subagent ??= {
            session: subagentSession({
                ...options,
                prompt: goalPrompt,
                customTools: [askTool(askHost(ctx.cwd))],
                waitingTools: [askToolName]
            }),
            knowsGoal: false,
            opened
        }
        return subagent
    }

    const start = (request: string, questions: boolean, typed?: string): Run => {
        stopRun()
        const run: Run = {
            request,
            typed,
            status: '',
            turns: 0,
            controller: new AbortController(),
            questions,
            askedThisTurn: false
        }
        running = run
        repaint?.()
        return run
    }

    const onProgress =
        (run: Run): SubagentUpdate =>
        event => {
            if (event.type === 'turn') {
                run.turns += 1
                run.askedThisTurn = false
            }

            run.status = runStatus(progressLabel(event), run.turns)
            repaint?.()
        }

    const failed = (run: Run, failure: unknown): void => {
        if (run.controller.signal.aborted) return
        closeSubagent()
        error = failure instanceof Error ? failure.message : String(failure)
        failedText = run.typed
        repaint?.()
    }

    const ask = async (ctx: ExtensionContext): Promise<void> => {
        const current = openSubagent(ctx)
        const unseen = current.knowsGoal ? {} : {request: state.request, goal: state.goal}
        const run = start(state.request ?? '', true)

        try {
            await current.session.prompt(
                () => questionsTask(unseen, state.decisions),
                run.controller.signal,
                onProgress(run)
            )
            if (run.controller.signal.aborted) return
            current.knowsGoal = true
            save({...state, asked: true})
            void planSteps(ctx)
        } catch (failure) {
            failed(run, failure)
        }
    }

    const planSteps = async (ctx: ExtensionContext, change?: string): Promise<void> => {
        const current = openSubagent(ctx)
        const unseen = {request: state.request, goal: state.goal}
        const head = current.knowsGoal ? [] : planHead(unseen, state.decisions)
        const run = start(state.request ?? '', false, change)
        const check = sendBackSteps(ctx.cwd, run.controller.signal)

        try {
            // Without the ask tool: refused calls after the questions cost restarts and the model
            // answered a refusal with a GOAL line (PLANNING_MODE.md, sections 15 and 16).
            const {text: reply} = await current.session.prompt(
                stepsTask(head, state, change),
                run.controller.signal,
                onProgress(run),
                check,
                [askToolName]
            )
            // The send back is skipped once the restarts are spent, so the last reply is unchecked.
            const plan = parseSteps(reply)
            const fault = await check(reply)

            if (run.controller.signal.aborted) return
            if (plan === undefined || fault !== undefined) throw new Error(noStepsLine)

            current.knowsGoal = true
            running = undefined
            save({
                ...state,
                ...plan,
                changes: change === undefined ? state.changes : [...state.changes, change]
            })
            repaint?.()
        } catch (failure) {
            failed(run, failure)
        }
    }

    const answerQuestion = (text: string): void => {
        const waiting = running?.waiting

        if (running === undefined || waiting === undefined) return
        running.waiting = undefined
        // Saved before the tool returns, so no way of ending the run can lose it.
        save({
            ...state,
            decisions: [...state.decisions, {question: waiting.question.question, answer: text}]
        })
        waiting.answer(text)
        repaint?.()
    }

    const refine = async (ctx: ExtensionContext, text: string): Promise<void> => {
        const request = state.request ?? text
        // Opened first: a fresh session must be told the request and the goal.
        const current = openSubagent(ctx)
        const task = taskFor(text)
        const run = start(request, false, text)

        try {
            const {text: reply} = await current.session.prompt(
                task,
                run.controller.signal,
                onProgress(run),
                sendBackGoal
            )
            const goal = parseGoal(reply)

            if (goal === undefined) {
                // The session's last reply is not the shown goal, so the next change resends it.
                current.knowsGoal = false
                error = noGoalLine
                failedText = text
            } else {
                current.knowsGoal = true
                save({...idle, request, goal})
            }

            running = undefined
            repaint?.()
        } catch (failure) {
            failed(run, failure)
        }
    }

    const open = (ctx: ExtensionContext): Promise<void> => {
        let overlay: OverlayHandle | undefined

        // pi's setHidden(false) on a closed overlay focuses the dead panel, so done() comes last.
        const askClose = async (done: () => void): Promise<void> => {
            const answer = await whileHidden(overlay, () =>
                ctx.ui.select(closeTitle, [keepLabel, stopLabel])
            )

            if (answer === stopLabel) done()
        }

        const editLoop = async (): Promise<void> => {
            const opened = state
            let prompt = editTitle
            let text = editText(opened)

            for (;;) {
                const edited = await ctx.ui.editor(prompt, text)

                if (edited === undefined || edited === '') return

                const checked = await checkEdit(ctx.cwd, opened, edited)

                if (checked === 'unchanged') return

                if ('plan' in checked) {
                    saveEdit(opened, checked.plan)
                    return
                }

                prompt = checked.reason
                text = edited
            }
        }

        const change = (text: string): void =>
            void (state.steps.length > 0 ? planSteps(ctx, text) : refine(ctx, text))

        return ctx.ui.custom<void>(
            (tui, theme, _keybindings, done) => {
                const actions: PanelActions = {
                    change,
                    retry: change,
                    accept: () => {
                        error = undefined
                        save({...state, accepted: true})
                        void ask(ctx)
                    },
                    answer: answerQuestion,
                    ask: () => void ask(ctx),
                    plan: () => void planSteps(ctx),
                    finish: () => {
                        closeSubagent()
                        save({...state, asked: true})
                        void planSteps(ctx)
                    },
                    changeGoal: () => {
                        closeSubagent()
                        save({...idle, request: state.request, goal: state.goal})
                        repaint?.()
                    },
                    handOver: () => {
                        done()
                        void handOver(ctx)
                    },
                    edit: () => void whileHidden(overlay, editLoop),
                    stop: () => {
                        save(idle)
                        void track(ctx)
                    },
                    close: () => done(),
                    leave: () => {
                        if (state.handed) done()
                        else void askClose(done)
                    }
                }
                const panel = new PlanPanel(
                    theme,
                    () => tui.requestRender(),
                    actions,
                    () => tui.terminal.rows - frameRows
                )
                repaint = (): void => {
                    panel.setState(panelState())
                    tui.requestRender()
                }

                panel.setState(panelState())
                return {
                    ...boxed(
                        panel,
                        title,
                        text => theme.fg('border', text),
                        text => theme.fg('accent', text)
                    ),
                    dispose: () => {
                        repaint = undefined
                        failedText = undefined
                        closeSubagent()
                    }
                }
            },
            {
                overlay: true,
                overlayOptions,
                onHandle: handle => {
                    overlay = handle
                }
            }
        )
    }
    pi.registerCommand('plan', {
        description: 'Open the planning panel. Text after the command is sent as the request.',
        handler: async (args, ctx) => {
            if (ctx.mode !== 'tui') {
                ctx.ui.notify(tuiOnly, 'warning')
                return
            }

            const text = args.trim()

            if (text !== '' && state !== idle) {
                save(idle)
                void track(ctx)
            }

            // Not awaited: a reload drops the overlay unsettled, and a waiting handler blocks pi.
            open(ctx).catch((failure: unknown) => {
                closeSubagent()
                ctx.ui.notify(String(failure), 'error')
            })
            if (text !== '') void refine(ctx, text)
        }
    })

    const restore = (_event: unknown, ctx: ExtensionContext): void => {
        state = lastPlan(ctx).state
        failedText = undefined
        void track(ctx)
    }
    pi.on('session_start', restore)
    pi.on('session_tree', restore)
    // Not turn_end: pi rebuilds the whole context for a turn_end handler, in every session.
    pi.on('tool_execution_end', ({toolName}, ctx) => {
        if (state.handed && diskTools.has(toolName)) void track(ctx)
    })
    pi.on('session_shutdown', closeSubagent)
}

export {
    closeTitle,
    editTitle,
    keepLabel,
    layoutTitle,
    misplacedTitles,
    noGoalLine,
    noStepsLine,
    stopLabel,
    tuiOnly
}
export type {PlanState}
