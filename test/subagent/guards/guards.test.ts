import {describe, expect, mock, test} from 'bun:test'
import type {AgentSession, AgentSessionEvent} from '@earendil-works/pi-coding-agent'

import {guardSettings, watchGuards} from '../../../src/subagent/guards/guards'
import {end, fakeClock, start} from './fake'

const minute = 60_000

const fakeSession = () => {
    const listeners: Array<(event: AgentSessionEvent) => void> = []
    const unsubscribe = mock(() => undefined)
    const abort = mock(() => Promise.resolve())
    const session = {
        subscribe: (listener: (event: AgentSessionEvent) => void) => {
            listeners.push(listener)
            return unsubscribe
        },
        abort
    } as unknown as AgentSession

    const emit = (event: AgentSessionEvent) => {
        for (const listener of listeners) listener(event)
    }

    return {session, emit, abort, unsubscribe}
}

const settings = {staleMs: 10 * minute, toolCallMs: 15 * minute, restarts: 2}
describe('guardSettings', () => {
    test('uses the defaults when nothing is saved', () => {
        expect(guardSettings({})).toEqual(settings)
    })

    test('reads the saved values and off turns a timer guard off', () => {
        expect(guardSettings({staleMinutes: 'off', toolCallMinutes: 5, restarts: 0})).toEqual({
            staleMs: undefined,
            toolCallMs: 5 * minute,
            restarts: 0
        })
    })
})

describe('watchGuards', () => {
    test('the first hit aborts the run and later hits are dropped', () => {
        const {session, emit, abort} = fakeSession()
        const clock = fakeClock()
        const watch = watchGuards(session, settings, 100, clock)
        emit(start('grep', {path: 'src'}, 'call-1'))
        clock.advance(15 * minute)
        expect(abort).toHaveBeenCalledTimes(1)
        expect(watch.hit()?.id).toBe('tool-call')

        for (let i = 0; i < 5; i += 1) emit(start('ls', {path: '.'}))
        expect(watch.hit()?.id).toBe('tool-call')
        expect(abort).toHaveBeenCalledTimes(1)
    })

    test('a hit after the run ended does not abort', () => {
        const {session, emit, abort} = fakeSession()
        const watch = watchGuards(session, settings, 0, fakeClock())
        emit({
            type: 'agent_end',
            messages: [
                {
                    role: 'assistant',
                    content: [{type: 'text', text: '<tool_call>'}],
                    stopReason: 'stop'
                }
            ]
        } as unknown as AgentSessionEvent)

        expect(watch.hit()?.id).toBe('leak')
        expect(abort).not.toHaveBeenCalled()
    })

    test('an agent_end that pi will retry keeps the run live for the guards', () => {
        const {session, emit, abort} = fakeSession()
        const clock = fakeClock()
        const watch = watchGuards(session, settings, 0, clock)
        emit({type: 'agent_end', messages: [], willRetry: true} as unknown as AgentSessionEvent)
        emit({type: 'agent_start'})
        for (let i = 0; i < 5; i += 1) emit(start('ls', {path: '.'}))

        expect(watch.hit()?.id).toBe('loop')
        expect(abort).toHaveBeenCalledTimes(1)
    })

    test('a timer that fires after the closing agent_end is ignored', () => {
        const {session, emit, abort} = fakeSession()
        const clock = fakeClock()
        const watch = watchGuards(session, settings, 0, clock)
        emit({type: 'agent_end', messages: []} as unknown as AgentSessionEvent)
        clock.advance(60 * minute)

        expect(watch.hit()).toBeUndefined()
        expect(abort).not.toHaveBeenCalled()
    })

    test('stop unsubscribes and disposes the timers', () => {
        const {session, emit, abort, unsubscribe} = fakeSession()
        const clock = fakeClock()
        const watch = watchGuards(session, settings, 0, clock)
        emit(start('grep', {path: 'src'}, 'call-1'))
        watch.stop()
        clock.advance(60 * minute)

        expect(unsubscribe).toHaveBeenCalledTimes(1)
        expect(clock.pending()).toBe(0)
        expect(abort).not.toHaveBeenCalled()
        expect(watch.hit()).toBeUndefined()
    })

    test('timer guards and churn are left out when off or without a window', () => {
        const {session, emit, abort} = fakeSession()
        const clock = fakeClock()
        watchGuards(session, {staleMs: undefined, toolCallMs: undefined, restarts: 2}, 0, clock)
        emit(start('read', {path: 'a.ts'}, 'call-1'))
        emit(end('read', {path: 'a.ts'}, {text: 'x'.repeat(4_000), toolCallId: 'call-1'}))
        clock.advance(600 * minute)

        expect(clock.pending()).toBe(0)
        expect(abort).not.toHaveBeenCalled()
    })

    test('uses the real clock by default', () => {
        const {session} = fakeSession()
        const watch = watchGuards(session, settings, 0)
        watch.stop()
        expect(watch.hit()).toBeUndefined()
    })
})
