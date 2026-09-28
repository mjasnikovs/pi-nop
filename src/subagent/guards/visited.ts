import {DEFAULT_MAX_LINES} from '@earendil-works/pi-coding-agent'

import type {Guard} from './guard'
import {noop} from './guard'

type ReadCall = {path: string; from: number; to: number}

type Visited = Guard & {list: () => string}

// MAGIC NUMBER: past a screenful of paths the tail costs prefill and is not read.
const shownPaths = 40

const readCall = (name: string, args: unknown): ReadCall | undefined => {
    if (name !== 'read' || typeof args !== 'object' || args === null) return undefined
    const {path, offset, limit} = args as {path?: unknown; offset?: unknown; limit?: unknown}

    if (typeof path !== 'string') return undefined
    const from = typeof offset === 'number' && offset >= 1 ? Math.floor(offset) : 1
    // pi's read stops at its line cap, so a read with no limit reaches that far, not the end.
    const lines = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : DEFAULT_MAX_LINES
    return {path, from, to: from + lines - 1}
}

const span = ({from, to}: ReadCall): string => `${from}-${to}`

const createVisited = (): Visited => {
    const spans = new Map<string, Set<string>>()

    return {
        onEvent: event => {
            if (event.type !== 'tool_execution_start') return
            const call = readCall(event.toolName, event.args)

            if (call === undefined) return
            const known = spans.get(call.path) ?? new Set<string>()
            known.add(span(call))
            spans.set(call.path, known)
        },
        dispose: noop,
        list: () => {
            if (spans.size === 0) return ''
            const shown = [...spans].slice(0, shownPaths)
            const rest = spans.size - shown.length
            const paths = shown.map(([path, lines]) => `${path} (lines ${[...lines].join(', ')})`)
            return (
                ` You have already read, do not re-open: ${paths.join(', ')}`
                + (rest > 0 ? `, and ${rest} more` : '')
                + '.'
            )
        }
    }
}

export {createVisited, readCall}
export type {ReadCall, Visited}
