import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent'

import {boxed} from '../config/box'
import {configuredOptions, runSubagent, safeConfig} from '../subagent/subagent'
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
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const lastState = (ctx: ExtensionContext): PlanState | undefined =>
    ctx.sessionManager
        .getEntries()
        .filter(entry => entry.type === 'custom' && entry.customType === entryType)
        .map(entry => (entry as {data?: PlanState}).data)
        .findLast(data => data !== undefined)

export default function (pi: ExtensionAPI) {
    let state = idle
    let run: AbortController | undefined
    let show: (panel: PanelState) => void = () => undefined

    const save = (next: PlanState): void => {
        state = next
        pi.appendEntry(entryType, state)
    }

    const refine = async (ctx: ExtensionContext, text: string): Promise<void> => {
        const request = state.request ?? text
        const task = goalTask({
            request,
            goal: state.goal,
            change: state.request === undefined ? undefined : text
        })
        const options = {
            ...configuredOptions(safeConfig(ctx), ctx, 'subagent'),
            prompt: goalPrompt
        }
        const panel = (running: boolean, status = '', error?: string): PanelState => ({
            goal: state.goal,
            accepted: false,
            running,
            status,
            error
        })
        run?.abort()
        run = new AbortController()
        show(panel(true))

        try {
            const {text: answer} = await runSubagent(
                task,
                run.signal,
                update => show(panel(true, oneLine(update.details?.lastAssistantText ?? ''))),
                options
            )
            const goal = parseGoal(answer)

            if (goal === undefined) {
                show(panel(false, '', noGoalLine))
                return
            }

            save({request, goal, accepted: false})
            show(panel(false))
        } catch (error) {
            if (run.signal.aborted) return
            show(panel(false, '', error instanceof Error ? error.message : String(error)))
        }
    }

    const open = (ctx: ExtensionContext): Promise<void> =>
        ctx.ui.custom<void>(
            (tui, theme, _keybindings, close) => {
                const done = (): void => {
                    show = () => undefined
                    close()
                }

                const panel = new PlanPanel(theme, () => tui.requestRender(), {
                    change: text => void refine(ctx, text),
                    accept: () => {
                        save({...state, accepted: true})
                        show(current())
                    },
                    handOver: () => {
                        const goal = state.goal
                        done()
                        save(idle)
                        if (goal !== undefined) pi.sendUserMessage(goal)
                    },
                    close: () => {
                        run?.abort()
                        done()
                    }
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
                return boxed(
                    panel,
                    title,
                    text => theme.fg('border', text),
                    text => theme.fg('accent', text)
                )
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

    pi.on('session_start', (_event, ctx) => {
        state = lastState(ctx) ?? idle
    })
}

export {noGoalLine, tuiOnly}
export type {PlanState}
