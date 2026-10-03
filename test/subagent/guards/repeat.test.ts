import {describe, expect, test} from 'bun:test'
import type {AgentSessionEvent} from '@earendil-works/pi-coding-agent'

import {createRepeat, repeatedBlock} from '../../../src/subagent/guards/repeat'
import {createVisited} from '../../../src/subagent/guards/visited'
import {end, start, trip} from './fake'

const update = (type: string, delta?: string): AgentSessionEvent =>
    ({type: 'message_update', assistantMessageEvent: {type, delta}}) as unknown as AgentSessionEvent

const block = "I'll just add it.\n\nWait, I'll check if I can find anything else.\n"
const times = (lines: string[], count: number): string[] => Array(count).fill(lines).flat()
describe('repeatedBlock', () => {
    test('finds a block that ends the lines eight times in a row', () => {
        expect(repeatedBlock(['x', ...times(['a', 'b'], 8)])).toBe(2)
        expect(repeatedBlock(times(['a', 'b', 'c'], 8))).toBe(3)
        expect(repeatedBlock(times(['a', 'b', 'b'], 8))).toBe(3)
        expect(repeatedBlock(times(['b', 'a', 'a', 'a'], 8))).toBe(4)
    })

    test('seven copies, one line on its own and a broken copy are not a loop', () => {
        expect(repeatedBlock(times(['a', 'b'], 7))).toBeUndefined()
        expect(repeatedBlock(times(['}'], 40))).toBeUndefined()
        expect(repeatedBlock(['intro', 'next', ...times(['}'], 16)])).toBeUndefined()
        expect(repeatedBlock([...times(['a', 'b'], 7), 'a', 'x'])).toBeUndefined()
        expect(
            repeatedBlock([...times(['a', 'b'], 4), 'x', ...times(['a', 'b'], 4)])
        ).toBeUndefined()
        expect(repeatedBlock([])).toBeUndefined()
    })
})

describe('createRepeat', () => {
    test('trips while the thinking streams, on the line that closes the eighth copy', () => {
        const onTrip = trip()
        const guard = createRepeat(onTrip, createVisited())
        guard.onEvent(update('thinking_start'))
        guard.onEvent(update('thinking_delta', `Let me look.\n${block.repeat(7)}I'll just add`))
        guard.onEvent(update('thinking_delta', " it.\n\nWait, I'll check if I can find anything"))
        expect(onTrip).not.toHaveBeenCalled()

        guard.onEvent(update('thinking_delta', ' else.\n'))
        expect(onTrip).toHaveBeenCalledWith({
            id: 'repeat',
            hint: expect.stringContaining('the same 2 lines 8 times in a row')
        })
    })

    test('watches the answer text the same way', () => {
        const onTrip = trip()
        const guard = createRepeat(onTrip, createVisited())
        guard.onEvent(update('text_start'))
        guard.onEvent(update('text_delta', block.repeat(8)))

        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('lines that differ only by indent are the same line', () => {
        const onTrip = trip()
        const guard = createRepeat(onTrip, createVisited())
        guard.onEvent(update('thinking_delta', 'a\nb\n  a\n\tb  \n'.repeat(4)))

        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('a new block starts clean, so copies across blocks do not add up', () => {
        for (const kind of ['thinking', 'text']) {
            const onTrip = trip()
            const guard = createRepeat(onTrip, createVisited())
            guard.onEvent(update('text_delta', block.repeat(7)))
            guard.onEvent(update(`${kind}_start`))
            guard.onEvent(update(`${kind}_delta`, block))
            guard.onEvent(update('toolcall_delta', block.repeat(8)))

            expect(onTrip).not.toHaveBeenCalled()
        }
    })

    test('a half line left by the last block is not glued to the next one', () => {
        const onTrip = trip()
        const guard = createRepeat(onTrip, createVisited())
        guard.onEvent(update('thinking_delta', 'half'))
        guard.onEvent(update('text_start'))
        guard.onEvent(update('text_delta', 'a\nb\n'.repeat(8)))

        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('the hint names the size of the block that repeated', () => {
        const onTrip = trip()
        const guard = createRepeat(onTrip, createVisited())
        guard.onEvent(update('thinking_delta', 'a\nb\nc\n'.repeat(8)))

        expect(onTrip).toHaveBeenCalledWith({
            id: 'repeat',
            hint: expect.stringContaining('the same 3 lines 8 times')
        })
    })

    test('a line is judged once its line break arrives, however the deltas cut it', () => {
        const onTrip = trip()
        const guard = createRepeat(onTrip, createVisited())
        for (const char of 'one\ntwo\n'.repeat(7) + 'one\ntwo')
            guard.onEvent(update('text_delta', char))
        expect(onTrip).not.toHaveBeenCalled()

        guard.onEvent(update('text_delta', '\n'))
        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('one line over and over stays cheap, with or without a break now and then', () => {
        const onTrip = trip()
        const guard = createRepeat(onTrip, createVisited())
        guard.onEvent(update('thinking_delta', 'Wait.\n'.repeat(8000)))
        guard.onEvent(update('thinking_start'))
        for (let row = 0; row < 30; row += 1)
            guard.onEvent(update('thinking_delta', `${'0 0 0 0\n'.repeat(1000)}row ${row}\n`))

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('the hint lists the reads that went with the attempt', () => {
        const onTrip = trip()
        const visited = createVisited()
        visited.onEvent(start('read', {path: 'a.ts'}))
        visited.onEvent(end('read', {path: 'a.ts'}))
        const guard = createRepeat(onTrip, visited)
        guard.onEvent(update('thinking_delta', block.repeat(8)))

        expect(onTrip).toHaveBeenCalledWith({
            id: 'repeat',
            hint: expect.stringContaining('a.ts (lines')
        })
    })
})
