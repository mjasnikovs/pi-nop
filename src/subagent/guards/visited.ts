import {DEFAULT_MAX_LINES} from '@earendil-works/pi-coding-agent'

import type {Guard} from './guard'
import {noop} from './guard'

type ReadCall = {path: string; from: number; to: number}

type Visited = Guard & {list: () => string}

// MAGIC NUMBER: past a screenful of paths the tail costs prefill and is not read.
const shownPaths = 40

// pi coerces a numeric string to a number before the tool runs, but the start event carries the
// raw arguments, and a small model sends "2001" as often as 2001.
const asNumber = (value: unknown): number | undefined => {
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined
}

const readCall = (name: string, args: unknown): ReadCall | undefined => {
    if (name !== 'read' || typeof args !== 'object' || args === null) return undefined
    const {path} = args as {path?: unknown}
    const offset = asNumber((args as {offset?: unknown}).offset)
    const limit = asNumber((args as {limit?: unknown}).limit)

    if (typeof path !== 'string') return undefined
    const from = offset !== undefined && offset >= 1 ? Math.floor(offset) : 1
    // pi's read stops at its line cap, so a read with no limit reaches that far, not the end.
    const lines = limit !== undefined && limit > 0 ? Math.floor(limit) : DEFAULT_MAX_LINES
    return {path, from, to: from + lines - 1}
}

// What the read actually returned. An error or an over-long first line returns no lines, and pi
// cuts a read at its byte cap, so the lines can fall short of those asked for.
const readEnd = (call: ReadCall, result: unknown, isError: boolean): ReadCall | undefined => {
    if (isError) return undefined
    const truncation = (result as {details?: {truncation?: {outputLines?: unknown}}} | undefined)
        ?.details?.truncation
    const lines = truncation?.outputLines

    if (typeof lines !== 'number') return call
    if (lines < 1) return undefined
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

    // A read counts once it returns. One that never came back read nothing.
    return {
        onEvent: event => {
            if (event.type === 'tool_execution_start') {
                const call = readCall(event.toolName, event.args)
                if (call !== undefined) pending.set(event.toolCallId, call)
            }

            if (event.type !== 'tool_execution_end') return
            const call = pending.get(event.toolCallId)
            pending.delete(event.toolCallId)
            const actual =
                call === undefined ? undefined : readEnd(call, event.result, event.isError)
            if (actual !== undefined) add(actual)
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
