import type {Clock, Guard, Timer, Trip} from './guard'
import {minutes} from './guard'

const staleHint = (ms: number): string =>
    `[SYSTEM NOTE: Your previous attempt was stopped because the model sent nothing for `
    + `${minutes(ms)}. That is a hang, not a mistake you made. Its conversation is gone. `
    + 'Redo the work from here.]'

// The timer runs from the prompt. Every event resets it. It pauses while a tool call runs, which
// the tool-call guard watches, and during pi's retry sleep, which sends no event until it ends.
const createStale = (trip: Trip, ms: number, clock: Clock): Guard => {
    let timer: Timer | undefined
    let running = 0
    let retrying = false

    const cancel = (): void => {
        if (timer !== undefined) clock.cancel(timer)
        timer = undefined
    }

    const arm = (): void => {
        cancel()
        if (running > 0 || retrying) return
        timer = clock.schedule(() => trip({id: 'stale', hint: staleHint(ms)}), ms)
    }
    arm()
    return {
        onEvent: event => {
            if (event.type === 'tool_execution_start') running += 1
            if (event.type === 'tool_execution_end') running = Math.max(0, running - 1)
            retrying = event.type === 'auto_retry_start'
            arm()
        },
        dispose: cancel
    }
}

export {createStale}
