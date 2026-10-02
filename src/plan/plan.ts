import type {
    CustomEntry,
    ExtensionAPI,
    ExtensionContext,
    SessionEntry
} from '@earendil-works/pi-coding-agent'
import type {OverlayHandle} from '@earendil-works/pi-tui'

import {boxed} from '../config/box'
import {configuredOptions, subagentSession} from '../subagent/subagent'
import type {SubagentSession} from '../subagent/subagent'
import {progressLabel} from '../subagent/progress'
import {oneLine} from '../subagent/subagentTui'
import {whileHidden} from '../tui/hidden'
import {goalPrompt, goalTask, parseGoal} from './goal'
import {PlanPanel} from './panel'
import type {PanelState} from './panel'

const entryType = 'plan-mode'
const title = 'PLAN'
const noGoalLine = 'The subagent gave no GOAL line. Send your text again or reword it.'
const tuiOnly = 'Plan mode needs the interactive UI.'
const overlayOptions = {width: '80%', maxHeight: '80%'} as const
const closeTitle = 'Close plan? A running subagent stops.'
const keepLabel = 'Keep planning'
const stopLabel = 'Close and stop'

type PlanState = {
    request?: string
    goal?: string
    accepted: boolean
}

const idle: PlanState = {accepted: false}

// The goal prompt allows no text before the answer, so tool turns report only their count.
const runStatus = (text: string, turns: number): string => {
    if (turns === 0) return oneLine(text)
    return oneLine(text) || `turn ${String(turns)}`
}

const isPlanEntry = (entry: SessionEntry): entry is CustomEntry<PlanState> =>
    entry.type === 'custom' && entry.customType === entryType

const lastState = (ctx: ExtensionContext): PlanState | undefined =>
    ctx.sessionManager
        .getBranch()
        .filter(isPlanEntry)
        .findLast(entry => entry.data !== undefined)?.data

export default function (pi: ExtensionAPI) {
    let state = idle
    let running: {request: string; status: string; controller: AbortController} | undefined
    let error: string | undefined
    let subagent: {session: SubagentSession; knowsGoal: boolean} | undefined
    let repaint: (() => void) | undefined

    // The only place panel state comes from, so a new field cannot miss a copy.
    const panelState = (): PanelState => ({
        request: state.request ?? running?.request,
        goal: state.goal,
        accepted: state.accepted && running === undefined,
        running: running !== undefined,
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

    const refine = async (ctx: ExtensionContext, text: string): Promise<void> => {
        const request = state.request ?? text
        const task = taskFor(text)
        subagent ??= {
            session: subagentSession({
                ...configuredOptions(ctx, 'subagent'),
                prompt: goalPrompt
            }),
            knowsGoal: false
        }
        const current = subagent
        stopRun()
        const run = {request, status: '', turns: 0, controller: new AbortController()}
        running = run
        repaint?.()

        try {
            const {text: answer} = await current.session.prompt(
                task,
                run.controller.signal,
                event => {
                    if (event.type === 'turn') run.turns += 1
                    run.status = runStatus(progressLabel(event), run.turns)
                    repaint?.()
                }
            )
            const goal = parseGoal(answer)

            if (goal === undefined) {
                // The session's last reply is not the shown goal, so the next change resends it.
                current.knowsGoal = false
                error = noGoalLine
            } else {
                current.knowsGoal = true
                save({request, goal, accepted: false})
            }

            running = undefined
            repaint?.()
        } catch (failure) {
            if (run.controller.signal.aborted) return
            closeSubagent()
            error = failure instanceof Error ? failure.message : String(failure)
            repaint?.()
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
                const panel = new PlanPanel(theme, () => tui.requestRender(), {
                    change: text => void refine(ctx, text),
                    accept: () => {
                        error = undefined
                        save({...state, accepted: true})
                        repaint?.()
                    },
                    handOver: () => {
                        const goal = state.goal
                        done()
                        save(idle)
                        if (goal !== undefined) pi.sendUserMessage(goal)
                    },
                    close: () => done(),
                    leave: () => void askClose(done)
                })
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
        state = lastState(ctx) ?? idle
    }
    pi.on('session_start', restore)
    pi.on('session_tree', restore)
    pi.on('session_shutdown', closeSubagent)
}

export {closeTitle, keepLabel, noGoalLine, stopLabel, tuiOnly}
export type {PlanState}
