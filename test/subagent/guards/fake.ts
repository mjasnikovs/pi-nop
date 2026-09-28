import {mock} from 'bun:test'
import type {AgentSessionEvent} from '@earendil-works/pi-coding-agent'

import type {Clock, GuardHit, Timer} from '../../../src/subagent/guards/guard'

type Pending = {fn: () => void; at: number}

// A clock the test moves by hand. Timers fire in order once the clock passes them.
const fakeClock = (): Clock & {advance: (ms: number) => void; pending: () => number} => {
    let now = 0
    let nextId = 1
    const timers = new Map<number, Pending>()

    return {
        schedule: (fn, ms) => {
            const id = nextId
            nextId += 1
            timers.set(id, {fn, at: now + ms})
            return id as unknown as Timer
        },
        cancel: timer => {
            timers.delete(timer as unknown as number)
        },
        advance: ms => {
            now += ms

            for (const [id, {fn, at}] of [...timers].sort(([, a], [, b]) => a.at - b.at)) {
                if (at > now) continue
                timers.delete(id)
                fn()
            }
        },
        pending: () => timers.size
    }
}

const trip = () => mock((_hit: GuardHit) => undefined)

const start = (
    toolName: string,
    args: unknown,
    toolCallId = `${toolName}-${JSON.stringify(args)}`
): AgentSessionEvent => ({type: 'tool_execution_start', toolCallId, toolName, args})

const end = (
    toolName: string,
    args: unknown,
    options: {isError?: boolean; text?: string; toolCallId?: string} = {}
): AgentSessionEvent => ({
    type: 'tool_execution_end',
    toolCallId: options.toolCallId ?? `${toolName}-${JSON.stringify(args)}`,
    toolName,
    result: {content: [{type: 'text', text: options.text ?? 'ok'}], details: undefined},
    isError: options.isError ?? false
})

const turnStart: AgentSessionEvent = {type: 'turn_start'}

export {end, fakeClock, start, trip, turnStart}
