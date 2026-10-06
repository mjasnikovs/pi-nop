import type {Guard, Trip} from './guard'
import {noop} from './guard'
import {createLineReader} from './lines'
import type {Visited} from './visited'

// MAGIC NUMBER: measured in PLANNING_MODE section 15. Healthy thinking said a second line 5 times.
const times = 8
// Thinking that drafts code says a fence or a brace this often. A loop says whole sentences.
const sentence = /^[A-Za-z].*[.!?]$/

const circleHint = (visited: Visited): string =>
    '[SYSTEM NOTE: Your previous attempt said the same lines over and over in its thinking and '
    + 'was stopped as a loop. Its conversation is discarded. Redo the work from here. Do not go '
    + `over a point twice: decide with what you know and answer.${visited.list()}]`

// A loop where one line changes each round never repeats a block, so the repeat guard is blind.
const createCircle = (trip: Trip, visited: Visited): Guard => {
    const reader = createLineReader()
    let said = new Map<string, number>()
    let often = 0

    return {
        onEvent: event => {
            if (event.type !== 'message_update') return
            const update = event.assistantMessageEvent

            if (update.type === 'thinking_start') {
                said = new Map()
                often = 0
                reader.reset()
                return
            }

            if (update.type !== 'thinking_delta') return

            for (const line of reader.take(update.delta)) {
                if (!sentence.test(line)) continue
                const count = (said.get(line) ?? 0) + 1
                said.set(line, count)
                if (count !== times) continue
                often += 1
                if (often === 2) trip({id: 'circle', hint: circleHint(visited)})
            }
        },
        dispose: noop
    }
}

export {createCircle}
