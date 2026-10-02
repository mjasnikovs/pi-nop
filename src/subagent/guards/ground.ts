import type {Guard, Trip} from './guard'
import {noop} from './guard'
import {callKey} from './key'
import type {Visited} from './visited'

// MAGIC NUMBER: pi-task's limit. Eight dead calls in a row is past any honest run of misses.
const limit = 8

const groundHint = (visited: Visited): string =>
    `[SYSTEM NOTE: Your previous attempt made ${limit} tool calls in a row that brought nothing `
    + 'new: repeats of earlier calls or errors. It was stopped and its conversation discarded. '
    + 'Redo the work from here. Read each region of a file at most once, and fix a failing call '
    + `instead of retrying it.${visited.list()}]`

// A tool that answers a reworded call from memory says so itself, since its call key is new.
const ownRepeat = (result: unknown): boolean =>
    (result as {details?: {repeat?: unknown}} | undefined)?.details?.repeat === true

// A call is dead when it repeats an earlier call of the attempt or comes back as an error.
const createGround = (
    trip: Trip,
    visited: Visited,
    waits: ReadonlySet<string> = new Set()
): Guard => {
    const seen = new Set<string>()
    const repeats = new Set<string>()
    const asked = new Map<string, string>()
    let streak = 0
    let waiting = 0
    let held = 0
    let answered = false

    // A refused question is asked again on purpose, so only one that went through is seen.
    const settle = (toolCallId: string, isError: boolean): void => {
        const key = asked.get(toolCallId)
        asked.delete(toolCallId)
        waiting -= 1
        if (!isError && key !== undefined) seen.add(key)
    }

    // Judged once no waiting call is in flight, so a dead call cannot stop a question on screen.
    const judge = (dead: boolean): void => {
        if (dead) held += 1
        else answered = true
        if (waiting > 0) return

        streak = answered ? 0 : streak + held
        held = 0
        answered = false
        if (streak >= limit) trip({id: 'ground', hint: groundHint(visited)})
    }

    return {
        onEvent: event => {
            if (event.type === 'tool_execution_start') {
                const key = callKey(event.toolName, event.args)
                if (seen.has(key)) repeats.add(event.toolCallId)

                if (!waits.has(event.toolName)) seen.add(key)
                else {
                    asked.set(event.toolCallId, key)
                    waiting += 1
                }
            }

            if (event.type !== 'tool_execution_end') return
            const repeat = repeats.delete(event.toolCallId) || ownRepeat(event.result)
            if (waits.has(event.toolName)) settle(event.toolCallId, event.isError)
            judge(repeat || event.isError)
        },
        dispose: noop
    }
}

export {createGround}
