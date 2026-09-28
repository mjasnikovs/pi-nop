import {describe, expect, test} from 'bun:test'

import {createToolCall} from '../../../src/subagent/guards/toolCall'
import {end, fakeClock, start, trip, turnStart} from './fake'

const minute = 60_000
describe('createToolCall', () => {
    test('trips when one call outlives the window, naming it', () => {
        const clock = fakeClock()
        const onTrip = trip()
        const guard = createToolCall(onTrip, 15 * minute, clock)
        guard.onEvent(start('grep', {path: '/', pattern: 'x'}, 'call-1'))
        clock.advance(14 * minute)
        guard.onEvent(turnStart)
        expect(onTrip).not.toHaveBeenCalled()

        clock.advance(minute)
        expect(onTrip).toHaveBeenCalledWith({
            id: 'tool-call',
            hint: expect.stringContaining(
                'called grep({"path":"/","pattern":"x"}) and it had not returned after 15 minutes'
            )
        })
    })

    test('a call that returns in time is forgotten, other calls keep their own timer', () => {
        const clock = fakeClock()
        const onTrip = trip()
        const guard = createToolCall(onTrip, 15 * minute, clock)
        guard.onEvent(start('grep', {path: 'a'}, 'call-1'))
        clock.advance(5 * minute)
        guard.onEvent(start('read', {path: 'b'}, 'call-2'))
        clock.advance(5 * minute)
        guard.onEvent(end('grep', {path: 'a'}, {toolCallId: 'call-1'}))
        clock.advance(9 * minute)
        expect(onTrip).not.toHaveBeenCalled()

        clock.advance(minute)
        expect(onTrip).toHaveBeenCalledTimes(1)
        expect((onTrip.mock.calls[0] as [{hint: string}])[0].hint).toContain('read(')
    })

    test('a repeated start for the same id re-arms it and an unknown end is ignored', () => {
        const clock = fakeClock()
        const onTrip = trip()
        const guard = createToolCall(onTrip, minute, clock)
        guard.onEvent(end('grep', {path: 'a'}, {toolCallId: 'ghost'}))
        guard.onEvent(start('grep', {path: 'a'}, 'call-1'))
        clock.advance(30_000)
        guard.onEvent(start('grep', {path: 'a'}, 'call-1'))
        clock.advance(30_000)
        expect(onTrip).not.toHaveBeenCalled()

        clock.advance(30_000)
        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('dispose cancels every running timer', () => {
        const clock = fakeClock()
        const onTrip = trip()
        const guard = createToolCall(onTrip, minute, clock)
        guard.onEvent(start('grep', {path: 'a'}, 'call-1'))
        guard.onEvent(start('grep', {path: 'b'}, 'call-2'))
        guard.dispose()
        clock.advance(5 * minute)

        expect(onTrip).not.toHaveBeenCalled()
        expect(clock.pending()).toBe(0)
    })
})
