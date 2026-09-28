import {contentText} from '@earendil-works/pi-ai'

import type {Guard, Trip} from './guard'
import {noop} from './guard'

const leakHint = (marker: string): string =>
    `[SYSTEM NOTE: Your previous attempt wrote a tool call as plain text (${marker}) instead of `
    + 'calling the tool, so it never ran. Call tools through the tool API. Never type '
    + '<tool_call>, <function=…> or <parameter=…> markup into your answer.]'

// A leaked call starts its own line. Markup quoted mid-line, as code evidence, is not a leak.
const toolCallTag = /^\s*(<tool_call\b[^>]*>)/im
const functionTag = /^\s*(<function=[\w.-]+\s*>)/im
const parameterTag = /^\s*<parameter=[\w.-]+\s*>/im

const leakedMarker = (text: string): string | undefined => {
    const tag = toolCallTag.exec(text)?.[1]
    if (tag !== undefined) return tag
    return parameterTag.test(text) ? functionTag.exec(text)?.[1] : undefined
}

// Checked once the run ended on its own: a leak is text the model wrote instead of a tool call.
const createLeak = (trip: Trip): Guard => ({
    onEvent: event => {
        if (event.type !== 'agent_end') return
        const last = event.messages.findLast(message => message.role === 'assistant')

        if (last === undefined || last.stopReason === 'error' || last.stopReason === 'aborted')
            return
        const marker = leakedMarker(contentText(last.content, ''))
        if (marker !== undefined) trip({id: 'leak', hint: leakHint(marker)})
    },
    dispose: noop
})

export {createLeak, leakedMarker}
