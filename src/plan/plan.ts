import type {
    CustomEntry,
    ExtensionAPI,
    ExtensionContext,
    SessionEntry
} from '@earendil-works/pi-coding-agent'
import {contentText} from '@earendil-works/pi-ai'

import {boxed} from '../config/box'
import {configuredOptions, safeConfig, subagentSession} from '../subagent/subagent'
import type {SubagentSession} from '../subagent/subagent'
import {oneLine} from '../subagent/subagentTui'
import {goalPrompt, goalTask, parseGoal} from './goal'
import {PlanPanel} from './panel'
import type {PanelState} from './panel'

const entryType = 'plan-mode'
const title = 'PLAN'
const noGoalLine = 'The subagent gave no GOAL line. Send your text again or reword it.'
const tuiOnly = 'Plan mode needs the interactive UI.'
const overlayOptions = {width: '80%', maxHeight: '80%'} as const

type PlanState = {
    request?: string
    goal?: string
    accepted: boolean
}

const idle: PlanState = {accepted: false}

const isPlanEntry = (entry: SessionEntry): entry is CustomEntry<PlanState> =>
    entry.type === 'custom' && entry.customType === entryType

const lastState = (ctx: ExtensionContext): PlanState | undefined =>
    ctx.sessionManager
        .getBranch()
        .filter(isPlanEntry)
        .findLast(entry => entry.data !== undefined)?.data

export default function (pi: ExtensionAPI) {
    let state = idle
    let run: AbortController | undefined
    let subagent: {session: SubagentSession; knowsGoal: boolean} | undefined
    let show: ((panel: PanelState) => void) | undefined

    const save = (next: PlanState): void => {
        state = next
        pi.appendEntry(entryType, state)
    }

    const closeSubagent = (): void => {
        run?.abort()
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
        const panel = (running: boolean, status = '', error?: string): PanelState => ({
            goal: state.goal,
            accepted: false,
            running,
            status,
            error
        })
        subagent ??= {
            session: subagentSession({
                ...configuredOptions(safeConfig(ctx), ctx, 'subagent'),
                prompt: goalPrompt
            }),
            knowsGoal: false
        }
        const current = subagent
        run?.abort()
        const controller = new AbortController()
        run = controller
        show?.(panel(true))

        try {
            const {text: answer} = await current.session.prompt(task, controller.signal, update =>
                show?.(panel(true, oneLine(contentText(update.content))))
            )
            const goal = parseGoal(answer)

            if (goal === undefined) {
                // The session's last reply is not the shown goal, so the next change resends it.
                current.knowsGoal = false
                show?.(panel(false, '', noGoalLine))
                return
            }

            current.knowsGoal = true

            save({request, goal, accepted: false})
            show?.(panel(false))
        } catch (error) {
            if (controller.signal.aborted) return
            closeSubagent()
            show?.(panel(false, '', error instanceof Error ? error.message : String(error)))
        }
    }

    const open = (ctx: ExtensionContext): Promise<void> =>
        ctx.ui.custom<void>(
            (tui, theme, _keybindings, done) => {
                const panel = new PlanPanel(theme, () => tui.requestRender(), {
                    change: text => void refine(ctx, text),
                    accept: () => {
                        save({...state, accepted: true})
                        show?.(current())
                    },
                    handOver: () => {
                        const goal = state.goal
                        done()
                        save(idle)
                        if (goal !== undefined) pi.sendUserMessage(goal)
                    },
                    close: () => done()
                })
                const current = (): PanelState => ({
                    goal: state.goal,
                    accepted: state.accepted,
                    running: false,
                    status: ''
                })
                show = (next: PanelState): void => {
                    panel.setState(next)
                    tui.requestRender()
                }

                panel.setState(current())
                return {
                    ...boxed(
                        panel,
                        title,
                        text => theme.fg('border', text),
                        text => theme.fg('accent', text)
                    ),
                    dispose: () => {
                        show = undefined
                        closeSubagent()
                    }
                }
            },
            {overlay: true, overlayOptions}
        )
    pi.registerCommand('plan', {
        description: 'Open the planning panel. Text after the command is sent as the request.',
        handler: async (args, ctx) => {
            if (ctx.mode !== 'tui') {
                ctx.ui.notify(tuiOnly, 'warning')
                return
            }

            const text = args.trim()
            const opened = open(ctx)

            if (text !== '') void refine(ctx, text)
            await opened
        }
    })

    const restore = (_event: unknown, ctx: ExtensionContext): void => {
        state = lastState(ctx) ?? idle
    }
    pi.on('session_start', restore)
    pi.on('session_tree', restore)
    pi.on('session_shutdown', closeSubagent)
}

export {noGoalLine, tuiOnly}
export type {PlanState}
