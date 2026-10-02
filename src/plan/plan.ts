import type {
    CustomEntry,
    ExtensionAPI,
    ExtensionContext,
    SessionEntry
} from '@earendil-works/pi-coding-agent'
import type {OverlayHandle} from '@earendil-works/pi-tui'

import {boxed, frameRows} from '../config/box'
import {configuredOptions, subagentSession} from '../subagent/subagent'
import type {SubagentSession, SubagentUpdate} from '../subagent/subagent'
import {progressLabel} from '../subagent/progress'
import {oneLine} from '../subagent/subagentTui'
import {whileHidden} from '../tui/hidden'
import {askTool, askToolName, handOverMessage, questionsTask, sameQuestion} from './ask'
import type {AskHost, Decision, Question} from './ask'
import {goalPrompt, goalTask, parseGoal} from './goal'
import {PlanPanel} from './panel'
import type {PanelActions, PanelState} from './panel'

const entryType = 'plan-mode'
const title = 'PLAN'
const noGoalLine = 'The subagent gave no GOAL line. Send your text again or reword it.'
const tuiOnly = 'Plan mode needs the interactive UI.'
// No maxHeight: pi would cut the rows and the input off the bottom. The panel fits itself.
const overlayOptions = {width: '80%'} as const
const closeTitle = 'Close plan? A running subagent stops.'
const keepLabel = 'Keep planning'
const stopLabel = 'Close and stop'

type PlanState = {
    request?: string
    goal?: string
    accepted: boolean
    decisions: Decision[]
    /** The questions step ran to its end or the user finished it. */
    asked: boolean
}

type Run = {
    request: string
    status: string
    turns: number
    controller: AbortController
    questions: boolean
    askedThisTurn: boolean
    waiting?: {question: Question; answer: (text: string) => void}
}

const idle: PlanState = {accepted: false, decisions: [], asked: false}

// The goal prompt allows no text before the answer, so tool turns report only their count.
const runStatus = (text: string, turns: number): string => {
    if (turns === 0) return oneLine(text)
    return oneLine(text) || `turn ${String(turns)}`
}

const isPlanEntry = (entry: SessionEntry): entry is CustomEntry<PlanState> =>
    entry.type === 'custom' && entry.customType === entryType

// An entry saved before the questions step has no decisions and no asked.
const lastState = (ctx: ExtensionContext): PlanState => {
    const saved = ctx.sessionManager
        .getBranch()
        .filter(isPlanEntry)
        .findLast(entry => entry.data !== undefined)?.data

    return saved === undefined ? idle : {...idle, ...saved}
}

export default function (pi: ExtensionAPI) {
    let state = idle
    let running: Run | undefined
    let error: string | undefined
    let subagent: {session: SubagentSession; knowsGoal: boolean} | undefined
    let repaint: (() => void) | undefined

    // The only place panel state comes from, so a new field cannot miss a copy.
    const panelState = (): PanelState => ({
        request: state.request ?? running?.request,
        goal: state.goal,
        accepted: state.accepted,
        asked: state.asked,
        decisions: state.decisions,
        question: running?.waiting?.question,
        running: running !== undefined && running.waiting === undefined,
        status: running?.status ?? '',
        error
    })

    const save = (next: PlanState): void => {
        state = next
        pi.appendEntry(entryType, state)
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

    // The tool is in the session from its first turn, since a later tool change empties the cache.
    const openSubagent = (
        ctx: ExtensionContext
    ): {session: SubagentSession; knowsGoal: boolean} => {
        subagent ??= {
            session: subagentSession({
                ...configuredOptions(ctx, 'subagent'),
                prompt: goalPrompt,
                customTools: [askTool(askHost(ctx.cwd))],
                waitingTools: [askToolName]
            }),
            knowsGoal: false
        }
        return subagent
    }

    const start = (request: string, questions: boolean): Run => {
        stopRun()
        const run: Run = {
            request,
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
            current.knowsGoal = true
            running = undefined
            save({...state, asked: true})
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
        const task = taskFor(text)
        const current = openSubagent(ctx)
        const run = start(request, false)

        try {
            const {text: reply} = await current.session.prompt(
                task,
                run.controller.signal,
                onProgress(run)
            )
            const goal = parseGoal(reply)

            if (goal === undefined) {
                // The session's last reply is not the shown goal, so the next change resends it.
                current.knowsGoal = false
                error = noGoalLine
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

        return ctx.ui.custom<void>(
            (tui, theme, _keybindings, done) => {
                const actions: PanelActions = {
                    change: text => void refine(ctx, text),
                    accept: () => {
                        error = undefined
                        save({...state, accepted: true})
                        void ask(ctx)
                    },
                    answer: answerQuestion,
                    ask: () => void ask(ctx),
                    finish: () => {
                        closeSubagent()
                        save({...state, asked: true})
                        repaint?.()
                    },
                    changeGoal: () => {
                        closeSubagent()
                        save({...idle, request: state.request, goal: state.goal})
                        repaint?.()
                    },
                    handOver: () => {
                        const {goal, decisions} = state
                        done()
                        save(idle)
                        if (goal !== undefined) pi.sendUserMessage(handOverMessage(goal, decisions))
                    },
                    close: () => done(),
                    leave: () => void askClose(done)
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
            if (text !== '' && state !== idle) save(idle)
            // Not awaited: a reload drops the overlay unsettled, and a waiting handler blocks pi.
            open(ctx).catch((failure: unknown) => {
                closeSubagent()
                ctx.ui.notify(String(failure), 'error')
            })
            if (text !== '') void refine(ctx, text)
        }
    })

    const restore = (_event: unknown, ctx: ExtensionContext): void => {
        state = lastState(ctx)
    }
    pi.on('session_start', restore)
    pi.on('session_tree', restore)
    pi.on('session_shutdown', closeSubagent)
}

export {closeTitle, keepLabel, noGoalLine, stopLabel, tuiOnly}
export type {PlanState}
