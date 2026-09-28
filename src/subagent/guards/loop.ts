import type {Guard, Trip} from './guard'
import {noop} from './guard'
import {callKey} from './key'
import type {ReadCall, Visited} from './visited'
import {readCall, readEnd} from './visited'

// MAGIC NUMBER: pi-task's tested pair. Fewer flags a model that re-checks one file; more lets
// a loop run for minutes before the kill.
const windowSize = 20
const threshold = 5

type Entry = {id: string; key: string; read: ReadCall | undefined}

const repeatHint = (name: string, args: unknown, count: number, visited: Visited): string =>
    `[SYSTEM NOTE: Your previous attempt called ${name}(${JSON.stringify(args)}) ${count} times `
    + `in its last ${windowSize} tool calls and was stopped as a loop. Its conversation is `
    + 'discarded. Redo the work from here without repeating that call. Take a different angle.'
    + `${visited.list()}]`

const revisitHint = (path: string, visited: Visited): string =>
    `[SYSTEM NOTE: Your previous attempt re-read ${path} ${threshold} times without reaching `
    + 'new lines and was stopped as a loop. Its conversation is discarded. Redo the work from '
    + 'here, reading each region of a file at most once. When a file is too large to read whole, '
    + `page forward through it instead of re-opening the start.${visited.list()}]`

// A read that goes past the highest line already read on that path is progress. Any other is
// a revisit.
const revisits = (window: Entry[], path: string): number => {
    let top = Number.NEGATIVE_INFINITY
    let count = 0

    for (const {read} of window) {
        if (read?.path !== path) continue
        if (read.to > top) top = read.to
        else count += 1
    }

    return count
}

const createLoop = (trip: Trip, visited: Visited): Guard => {
    const window: Entry[] = []

    return {
        onEvent: event => {
            if (event.type === 'tool_execution_end') {
                const entry = window.find(other => other.id === event.toolCallId)
                if (entry?.read !== undefined)
                    entry.read = readEnd(entry.read, event.result, event.isError)
                return
            }

            if (event.type !== 'tool_execution_start') return
            const {toolCallId, toolName, args} = event
            const entry = {
                id: toolCallId,
                key: callKey(toolName, args),
                read: readCall(toolName, args)
            }
            window.push(entry)
            if (window.length > windowSize) window.shift()

            const count = window.filter(other => other.key === entry.key).length

            if (count >= threshold) {
                trip({id: 'loop', hint: repeatHint(toolName, args, count, visited)})
                return
            }

            if (entry.read !== undefined && revisits(window, entry.read.path) >= threshold)
                trip({id: 'loop', hint: revisitHint(entry.read.path, visited)})
        },
        dispose: noop
    }
}

export {createLoop}
