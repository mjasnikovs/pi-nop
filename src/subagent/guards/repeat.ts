import type {Guard, Trip} from './guard'
import {noop} from './guard'
import type {Visited} from './visited'

// MAGIC NUMBER: measured in PLANNING_MODE section 11. Fewer copies hit more quoted files.
const copies = 8

const repeatHint = (size: number, visited: Visited): string =>
    `[SYSTEM NOTE: Your previous attempt wrote the same ${size} lines ${copies} times in a row `
    + 'and was stopped as a loop. Its conversation is discarded. Redo the work from here. Do not '
    + `go over a point twice: decide with what you know and answer.${visited.list()}]`

const tailOfOneLine = (lines: string[]): number => {
    const last = lines.length - 1
    let run = 1
    while (run <= last && lines[last - run] === lines[last]) run += 1
    return run
}

const repeatedBlock = (lines: string[]): number | undefined => {
    const last = lines.length - 1
    const tail = tailOfOneLine(lines)

    // One line many times over is healthy output too: closing braces, an empty grid.
    for (let size = tail + 1; size * copies <= lines.length; size += 1) {
        // Without this each size walks a long tail of equal lines before it fails.
        if (lines[last - tail] !== lines[last - tail - size]) continue
        const span = size * (copies - 1)
        let same = 0
        while (same < span && lines[last - same] === lines[last - same - size]) same += 1
        if (same === span) return size
    }

    return undefined
}

// A model looping inside one block makes no tool call, so no other guard sees it.
const createRepeat = (trip: Trip, visited: Visited): Guard => {
    let lines: string[] = []
    let open = ''

    return {
        onEvent: event => {
            if (event.type !== 'message_update') return
            const update = event.assistantMessageEvent

            if (update.type === 'thinking_start' || update.type === 'text_start') {
                lines = []
                open = ''
                return
            }

            if (update.type !== 'thinking_delta' && update.type !== 'text_delta') return
            const rows = update.delta.split('\n')
            rows[0] = open + (rows[0] ?? '')
            open = rows.pop() ?? ''

            for (const row of rows) {
                const line = row.trim()
                if (line === '') continue
                lines.push(line)
                const size = repeatedBlock(lines)

                if (size !== undefined) {
                    trip({id: 'repeat', hint: repeatHint(size, visited)})
                    return
                }
            }
        },
        dispose: noop
    }
}

export {createRepeat, repeatedBlock}
