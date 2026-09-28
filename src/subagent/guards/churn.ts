import type {AgentToolResult} from '@earendil-works/pi-agent-core'
import {estimateTokens} from '@earendil-works/pi-coding-agent'

import type {Guard, Trip} from './guard'
import {noop} from './guard'

// MAGIC NUMBER: pi-task's factor. A local server drops the oldest context without a word, so
// results past twice the window mean the model is re-reading what it already lost.
const factor = 2

const churnHint =
    '[SYSTEM NOTE: Your previous attempt pulled in more file content than its context window '
    + 'holds twice over, so the earliest material was dropped and it began re-reading it. It '
    + 'was stopped and its conversation discarded. Redo the work from here, reading only what '
    + 'the answer needs.]'

const createChurn = (trip: Trip, contextWindow: number): Guard => {
    let tokens = 0

    return {
        onEvent: event => {
            if (event.type !== 'tool_execution_end') return
            tokens += estimateTokens({
                role: 'toolResult',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                content: (event.result as AgentToolResult).content,
                isError: event.isError,
                timestamp: Date.now()
            })
            if (tokens > contextWindow * factor) trip({id: 'churn', hint: churnHint})
        },
        dispose: noop
    }
}

export {createChurn}
