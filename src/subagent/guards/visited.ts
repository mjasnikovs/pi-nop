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

// pi also cuts a read at its byte cap, so the lines it returned can fall short of those asked for.
const readEnd = (call: ReadCall, result: unknown): ReadCall => {
    const truncation = (result as {details?: {truncation?: {outputLines?: unknown}}} | undefined)
        ?.details?.truncation
    const lines = truncation?.outputLines

    if (typeof lines !== 'number' || lines < 1) return call
    return {...call, to: Math.min(call.to, call.from + lines - 1)}
}

const span = ({from, to}: ReadCall): string => `${from}-${to}`

const createVisited = (): Visited => {
    const spans = new Map<string, Set<string>>()
    const pending = new Map<string, ReadCall>()

    const add = (call: ReadCall): void => {
        const known = spans.get(call.path) ?? new Set<string>()
        known.add(span(call))
        spans.set(call.path, known)
    }

    return {
        onEvent: event => {
            if (event.type === 'tool_execution_start') {
                const call = readCall(event.toolName, event.args)

                if (call === undefined) return
                pending.set(event.toolCallId, call)
                add(call)
            }

            if (event.type !== 'tool_execution_end') return
            const call = pending.get(event.toolCallId)
            pending.delete(event.toolCallId)

            if (call === undefined) return
            const actual = readEnd(call, event.result)

            if (actual.to === call.to) return
            spans.get(call.path)?.delete(span(call))
            add(actual)
        },
        dispose: noop,
        list: () => {
            if (spans.size === 0) return ''
            const shown = [...spans].slice(0, shownPaths)
            const rest = spans.size - shown.length
            const paths = shown.map(([path, lines]) => `${path} (lines ${[...lines].join(', ')})`)
            return (
                ` Its reads, gone with it: ${paths.join(', ')}`
                + (rest > 0 ? `, and ${rest} more` : '')
                + '.'
            )
        }
    }
}

export {createVisited, readCall, readEnd}
export type {ReadCall, Visited}
