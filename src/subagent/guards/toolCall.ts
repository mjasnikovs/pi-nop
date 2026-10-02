import type {Clock, Guard, Timer, Trip} from './guard'
import {minutes} from './guard'

const toolCallHint = (name: string, args: unknown, ms: number): string =>
    `[SYSTEM NOTE: Your previous attempt called ${name}(${JSON.stringify(args)}) and it had not `
    + `returned after ${minutes(ms)}, so the attempt was stopped and its conversation discarded. `
    + 'Do not repeat that call. Narrow it, or work from what you already have.]'

// A tool in waits is held open by the user, not by a stuck call, so it gets no timer.
const createToolCall = (
    trip: Trip,
    ms: number,
    clock: Clock,
    waits: ReadonlySet<string> = new Set()
): Guard => {
    const timers = new Map<string, Timer>()

    const clear = (id: string): void => {
        const timer = timers.get(id)
        if (timer !== undefined) clock.cancel(timer)
        timers.delete(id)
    }

    return {
        onEvent: event => {
            if (event.type === 'tool_execution_start' && !waits.has(event.toolName)) {
                const {toolCallId, toolName, args} = event
                clear(toolCallId)
                timers.set(
                    toolCallId,
                    clock.schedule(
                        () => trip({id: 'tool-call', hint: toolCallHint(toolName, args, ms)}),
                        ms
                    )
                )
            }

            if (event.type === 'tool_execution_end') clear(event.toolCallId)
        },
        dispose: () => {
            for (const id of [...timers.keys()]) clear(id)
        }
    }
}

export {createToolCall}
