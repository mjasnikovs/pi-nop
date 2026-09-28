import type {AgentSessionEvent} from '@earendil-works/pi-coding-agent'

type GuardId = 'loop' | 'stale' | 'tool-call' | 'ground' | 'churn' | 'leak'

type GuardHit = {id: GuardId; hint: string}

type Trip = (hit: GuardHit) => void

type Guard = {onEvent: (event: AgentSessionEvent) => void; dispose: () => void}

type Timer = ReturnType<typeof setTimeout>

type Clock = {schedule: (fn: () => void, ms: number) => Timer; cancel: (timer: Timer) => void}

const realClock: Clock = {
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: timer => clearTimeout(timer)
}

const noop = (): void => undefined
const minutes = (ms: number): string => `${Math.round(ms / 60_000)} minutes`

export {minutes, noop, realClock}
export type {Clock, Guard, GuardHit, GuardId, Timer, Trip}
