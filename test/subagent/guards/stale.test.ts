import {describe, expect, test} from 'bun:test'

import {createStale} from '../../../src/subagent/guards/stale'
import {end, fakeClock, start, trip, turnStart} from './fake'

const minute = 60_000
describe('createStale', () => {
    test('trips once nothing arrives for the whole window', () => {
        const clock = fakeClock()
        const onTrip = trip()
        createStale(onTrip, 10 * minute, clock)
        clock.advance(9 * minute)
        expect(onTrip).not.toHaveBeenCalled()

        clock.advance(minute)
        expect(onTrip).toHaveBeenCalledWith({
            id: 'stale',
            hint: expect.stringContaining('sent nothing for 10 minutes')
        })
    })

    test('every event restarts the window', () => {
        const clock = fakeClock()
        const onTrip = trip()
        const guard = createStale(onTrip, 10 * minute, clock)
        clock.advance(9 * minute)
        guard.onEvent(turnStart)
        clock.advance(9 * minute)
        guard.onEvent({type: 'message_start', message: {role: 'user', content: '', timestamp: 0}})
        clock.advance(9 * minute)

        expect(onTrip).not.toHaveBeenCalled()
        clock.advance(minute)
        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('pauses while a tool call runs and while pi waits to retry', () => {
        const clock = fakeClock()
        const onTrip = trip()
        const guard = createStale(onTrip, 10 * minute, clock)
        guard.onEvent(start('grep', {path: 'src'}, 'call-1'))
        guard.onEvent(start('read', {path: 'a.ts'}, 'call-2'))
        clock.advance(30 * minute)
        guard.onEvent(end('grep', {path: 'src'}, {toolCallId: 'call-1'}))
        clock.advance(30 * minute)
        guard.onEvent(end('read', {path: 'a.ts'}, {toolCallId: 'call-2'}))
        expect(onTrip).not.toHaveBeenCalled()

        clock.advance(9 * minute)
        guard.onEvent({
            type: 'auto_retry_start',
            attempt: 1,
            maxAttempts: 3,
            delayMs: 1,
            errorMessage: 'x'
        })
        clock.advance(30 * minute)
        guard.onEvent({type: 'agent_start'})
        clock.advance(9 * minute)
        expect(onTrip).not.toHaveBeenCalled()

        clock.advance(minute)
        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('a retried request that never streams is caught', () => {
        const clock = fakeClock()
        const onTrip = trip()
        const guard = createStale(onTrip, 10 * minute, clock)
        guard.onEvent({
            type: 'auto_retry_start',
            attempt: 1,
            maxAttempts: 3,
            delayMs: 1,
            errorMessage: 'x'
        })
        clock.advance(60 * minute)
        expect(onTrip).not.toHaveBeenCalled()

        guard.onEvent({type: 'agent_start'})
        clock.advance(10 * minute)
        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('an end without a start does not unbalance the pause', () => {
        const clock = fakeClock()
        const onTrip = trip()
        const guard = createStale(onTrip, minute, clock)
        guard.onEvent(end('grep', {path: 'src'}))
        guard.onEvent(start('grep', {path: 'src'}))
        clock.advance(5 * minute)
        expect(onTrip).not.toHaveBeenCalled()

        guard.onEvent(end('grep', {path: 'src'}))
        clock.advance(minute)
        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('dispose cancels the timer', () => {
        const clock = fakeClock()
        const onTrip = trip()
        const guard = createStale(onTrip, minute, clock)
        guard.dispose()
        clock.advance(5 * minute)

        expect(onTrip).not.toHaveBeenCalled()
        expect(clock.pending()).toBe(0)
    })
})
