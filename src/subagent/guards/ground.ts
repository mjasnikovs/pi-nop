import type {Guard, Trip} from './guard'
import {noop} from './guard'
import {callKey} from './key'
import type {Visited} from './visited'

// MAGIC NUMBER: pi-task's limit. Eight dead calls in a row is past any honest run of misses.
const limit = 8

const groundHint = (visited: Visited): string =>
    `[SYSTEM NOTE: Your previous attempt made ${limit} tool calls in a row that brought nothing `
    + 'new: repeats of earlier calls or errors. It was stopped. Read each region of a file at '
    + 'most once, fix a failing call instead of retrying it, and write your answer from what you '
    + `have gathered.${visited.list()}]`

// A call is dead when it repeats an earlier call of the attempt or comes back as an error.
const createGround = (trip: Trip, visited: Visited): Guard => {
    const seen = new Set<string>()
    const repeats = new Set<string>()
    let streak = 0

    return {
        onEvent: event => {
            if (event.type === 'tool_execution_start') {
                const key = callKey(event.toolName, event.args)
                if (seen.has(key)) repeats.add(event.toolCallId)
                seen.add(key)
            }

            if (event.type !== 'tool_execution_end') return
            const repeat = repeats.delete(event.toolCallId)
            streak = event.isError || repeat ? streak + 1 : 0
            if (streak >= limit) trip({id: 'ground', hint: groundHint(visited)})
        },
        dispose: noop
    }
}

export {createGround}
