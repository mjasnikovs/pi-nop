import type {AgentSession, AgentSessionEvent} from '@earendil-works/pi-coding-agent'

import type {NopConfig} from '../../config/config'
import {read, restarts, staleMinutes, toolCallMinutes} from '../../config/config'
import {createChurn} from './churn'
import {createCircle} from './circle'
import type {Clock, Guard, GuardHit} from './guard'
import {realClock} from './guard'
import {createGround} from './ground'
import {createLeak} from './leak'
import {createLoop} from './loop'
import {createRepeat} from './repeat'
import {createStale} from './stale'
import {createToolCall} from './toolCall'
import {createVisited} from './visited'

type GuardSettings = {
    staleMs: number | undefined
    toolCallMs: number | undefined
    restarts: number
    waits?: ReadonlySet<string>
}

type GuardWatch = {hit: () => GuardHit | undefined; stop: () => void}

const minutesToMs = (value: number | 'off'): number | undefined =>
    value === 'off' ? undefined : value * 60_000

const guardSettings = (nop: NopConfig): GuardSettings => ({
    staleMs: minutesToMs(read(nop, staleMinutes)),
    toolCallMs: minutesToMs(read(nop, toolCallMinutes)),
    restarts: read(nop, restarts)
})

// A server that sends no tool call id leaves pi with ''. Pairing each end with the oldest open
// start of its tool keeps one entry per call. Two calls of one tool can still swap.
const nameBlankIds = (): ((event: AgentSessionEvent) => AgentSessionEvent) => {
    const open: {toolCallId: string; toolName: string}[] = []
    let count = 0

    return event => {
        if (event.type === 'tool_execution_start' && event.toolCallId === '') {
            count += 1
            const toolCallId = `blank-${count}`
            open.push({toolCallId, toolName: event.toolName})
            return {...event, toolCallId}
        }

        if (event.type !== 'tool_execution_end' || event.toolCallId !== '') return event

        const at = open.findIndex(call => call.toolName === event.toolName)
        const [started] = at === -1 ? [] : open.splice(at, 1)
        return {...event, toolCallId: started?.toolCallId ?? ''}
    }
}

// One subscription for the attempt. The first hit wins and aborts the run if it is still going.
const watchGuards = (
    session: AgentSession,
    settings: GuardSettings,
    contextWindow: number,
    clock: Clock = realClock
): GuardWatch => {
    let hit: GuardHit | undefined
    let closing = false
    let ended = false

    // A trip during the closing agent_end has nothing left to abort. One after it is stale.
    const trip = (next: GuardHit): void => {
        if (hit !== undefined || ended) return
        hit = next
        if (!closing) void session.abort()
    }

    const visited = createVisited()
    const guards: Guard[] = [
        visited,
        createLoop(trip, visited),
        createGround(trip, visited, settings.waits),
        createLeak(trip),
        createRepeat(trip, visited),
        createCircle(trip, visited)
    ]
    if (settings.staleMs !== undefined) guards.push(createStale(trip, settings.staleMs, clock))
    if (settings.toolCallMs !== undefined)
        guards.push(createToolCall(trip, settings.toolCallMs, clock, settings.waits))
    if (contextWindow > 0) guards.push(createChurn(trip, contextWindow))

    const named = nameBlankIds()
    const unsubscribe = session.subscribe(raw => {
        const event = named(raw)
        closing = event.type === 'agent_end' && !event.willRetry
        for (const guard of guards) guard.onEvent(event)
        if (closing) ended = true
    })

    return {
        hit: () => hit,
        stop: () => {
            unsubscribe()
            for (const guard of guards) guard.dispose()
        }
    }
}

export {guardSettings, watchGuards}
export type {GuardSettings, GuardWatch}
