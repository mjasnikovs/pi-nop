import type {SessionStats} from '@earendil-works/pi-coding-agent'
import type {AssistantMessage} from '@earendil-works/pi-ai'

type SubagentDetails = SessionStats
    & Pick<AssistantMessage, 'model' | 'provider' | 'stopReason' | 'timestamp'> & {
        task: string
        lastAssistantText: string
        elapsedMs: number
        restarts: number
    }

type SubagentProgress =
    | {type: 'queued'}
    | {type: 'started'}
    | {type: 'turn'; text: string; details: SubagentDetails}
    | {type: 'restarting'; guard: string}

type SubagentUpdate = ((event: SubagentProgress) => void) | undefined

const progressLabel = (event: SubagentProgress): string => {
    switch (event.type) {
        case 'queued':
            return 'queued…'
        case 'started':
            return ''
        case 'turn':
            return event.text
        case 'restarting':
            return `restarting: ${event.guard}`
    }
}

export {progressLabel}
export type {SubagentDetails, SubagentProgress, SubagentUpdate}
