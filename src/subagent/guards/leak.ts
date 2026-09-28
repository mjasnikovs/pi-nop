import type {AssistantMessage} from '@earendil-works/pi-ai'
import {contentText} from '@earendil-works/pi-ai'

import type {Guard, Trip} from './guard'
import {noop} from './guard'

const leakHint = (marker: string): string =>
    `[SYSTEM NOTE: Your previous attempt wrote a tool call as plain text (${marker}) instead of `
    + 'calling the tool, so it never ran. Call tools through the tool API. Never type '
    + '<tool_call>, <function=…> or <parameter=…> markup into your answer.]'

// A leaked call starts its own line outside a code fence. Markup quoted mid-line or fenced, as
// evidence, is not a leak.
const fence = /```[\s\S]*?```/g
const toolCallTag = /^\s*(<tool_call\b[^>]*>)/im
const functionTag = /^\s*(<function=[\w.-]+\s*>)/im
const parameterTag = /^\s*<parameter=[\w.-]+\s*>/im

const leakedMarker = (answer: string): string | undefined => {
    const text = answer.replace(fence, '')
    const tag = toolCallTag.exec(text)?.[1]
    if (tag !== undefined) return tag
    return parameterTag.test(text) ? functionTag.exec(text)?.[1] : undefined
}

// A cut-off or failed run is reported as that, not as a leak.
const checked = new Set<AssistantMessage['stopReason']>(['stop', 'toolUse'])

// Checked once the run ended on its own: a leak is text the model wrote instead of a tool call.
const createLeak = (trip: Trip): Guard => ({
    onEvent: event => {
        if (event.type !== 'agent_end') return
        const last = event.messages.findLast(message => message.role === 'assistant')

        if (last === undefined || !checked.has(last.stopReason)) return
        const marker = leakedMarker(contentText(last.content))
        if (marker !== undefined) trip({id: 'leak', hint: leakHint(marker)})
    },
    dispose: noop
})

export {createLeak, leakedMarker}
