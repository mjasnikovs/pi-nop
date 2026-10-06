import {describe, expect, test} from 'bun:test'
import type {AgentSessionEvent} from '@earendil-works/pi-coding-agent'

import {createCircle} from '../../../src/subagent/guards/circle'
import {createVisited} from '../../../src/subagent/guards/visited'
import {end, start, trip} from './fake'

const update = (type: string, delta?: string): AgentSessionEvent =>
    ({type: 'message_update', assistantMessageEvent: {type, delta}}) as unknown as AgentSessionEvent

// The shape Gemma loops in: one line changes each round, so no block of lines ever repeats.
const round = (index: number): string =>
    `Wait, I'll check if I should use sql for route ${String(index)}.\nYes.\n\nI'll proceed.\n`
const rounds = (count: number, from = 0): string =>
    Array.from({length: count}, (_, index) => round(from + index)).join('')
describe('createCircle', () => {
    test('trips when a second line of the thinking is said for the eighth time', () => {
        const onTrip = trip()
        const guard = createCircle(onTrip, createVisited())
        guard.onEvent(update('thinking_start'))
        guard.onEvent(update('thinking_delta', `${rounds(7)}${round(7).slice(0, -1)}`))
        expect(onTrip).not.toHaveBeenCalled()

        guard.onEvent(update('thinking_delta', '\n'))
        expect(onTrip).toHaveBeenCalledTimes(1)
        expect(onTrip).toHaveBeenCalledWith({
            id: 'circle',
            hint: expect.stringContaining('said the same lines over and over')
        })
    })

    test('lines said after the trip do not trip again', () => {
        const onTrip = trip()
        const guard = createCircle(onTrip, createVisited())
        guard.onEvent(update('thinking_delta', rounds(8)))
        guard.onEvent(update('thinking_delta', `${rounds(1, 8)}Done.\n`.repeat(8)))

        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('one line said over and over is not a loop', () => {
        const onTrip = trip()
        const guard = createCircle(onTrip, createVisited())
        guard.onEvent(
            update(
                'thinking_delta',
                Array.from({length: 40}, (_, index) => `Check ${String(index)}.\nYes.\n`).join('')
            )
        )

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('lines that are not sentences do not count: code, fences, list rows', () => {
        const onTrip = trip()
        const guard = createCircle(onTrip, createVisited())
        const draft =
            '```typescript\nconst a = b.c\nimport x from "./y"\n}\n})\n```\n- item\nreturn [\n'
        guard.onEvent(update('thinking_delta', draft.repeat(40)))
        guard.onEvent(
            update('thinking_delta', '- Returns 401.\n1. Run the tests.\n`x` is set.\n'.repeat(40))
        )

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('a line counts with any end mark, any indent and a small first letter', () => {
        const onTrip = trip()
        const guard = createCircle(onTrip, createVisited())
        guard.onEvent(update('thinking_delta', 'Is it there?\n  let me look!\n'.repeat(7)))
        guard.onEvent(update('thinking_delta', '\tIs it there?  \nlet me look!\n'))

        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('the answer text is not watched', () => {
        const onTrip = trip()
        const guard = createCircle(onTrip, createVisited())
        guard.onEvent(update('text_start'))
        guard.onEvent(update('text_delta', rounds(20)))
        guard.onEvent(update('toolcall_delta', rounds(20)))

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('a new thinking block starts clean', () => {
        const counts = trip()
        const counted = createCircle(counts, createVisited())
        counted.onEvent(update('thinking_delta', rounds(7)))
        counted.onEvent(update('thinking_start'))
        counted.onEvent(update('thinking_delta', rounds(1, 7)))
        expect(counts).not.toHaveBeenCalled()

        const lines = trip()
        const lined = createCircle(lines, createVisited())
        lined.onEvent(update('thinking_delta', 'Yes.\n'.repeat(8)))
        lined.onEvent(update('thinking_start'))
        lined.onEvent(update('thinking_delta', "I'll proceed.\n".repeat(8)))
        expect(lines).not.toHaveBeenCalled()
    })

    test('a half line left by the last block is not glued to the next one', () => {
        const onTrip = trip()
        const guard = createCircle(onTrip, createVisited())
        guard.onEvent(update('thinking_delta', "I'll proc"))
        guard.onEvent(update('thinking_start'))
        guard.onEvent(
            update('thinking_delta', `eed.\n${"I'll proceed.\n".repeat(7)}${'Yes.\n'.repeat(8)}`)
        )

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('the hint lists the reads that went with the attempt', () => {
        const onTrip = trip()
        const visited = createVisited()
        visited.onEvent(start('read', {path: 'a.ts'}))
        visited.onEvent(end('read', {path: 'a.ts'}))
        const guard = createCircle(onTrip, visited)
        guard.onEvent(update('thinking_delta', rounds(8)))

        expect(onTrip).toHaveBeenCalledWith({
            id: 'circle',
            hint: expect.stringContaining('a.ts (lines')
        })
    })
})
