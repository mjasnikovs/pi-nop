import {describe, expect, test} from 'bun:test'
import type {AgentSessionEvent} from '@earendil-works/pi-coding-agent'
import type {AssistantMessage} from '@earendil-works/pi-ai'

import {createLeak, leakedMarker} from '../../../src/subagent/guards/leak'
import {trip, turnStart} from './fake'

const assistant = (text: string, stopReason: AssistantMessage['stopReason'] = 'stop') =>
    ({
        role: 'assistant',
        content: [{type: 'text', text}],
        stopReason
    }) as unknown as AssistantMessage

const agentEnd = (messages: unknown[]): AgentSessionEvent =>
    ({type: 'agent_end', messages}) as unknown as AgentSessionEvent
describe('leakedMarker', () => {
    test('finds a tool_call tag, or a function tag with a parameter tag', () => {
        expect(leakedMarker('sure\n  <tool_call name="x"> {}')).toBe('<tool_call name="x">')
        expect(leakedMarker('<TOOL_CALL>')).toBe('<TOOL_CALL>')
        expect(leakedMarker('<function=read>\n<parameter=path>a</parameter>')).toBe(
            '<function=read>'
        )
        expect(leakedMarker('<function=read> only')).toBeUndefined()
        expect(leakedMarker('<parameter=path> only')).toBeUndefined()
        expect(leakedMarker('plain answer')).toBeUndefined()
        expect(
            leakedMarker('the fixture:\n```\n<tool_call>\n{}\n</tool_call>\n```')
        ).toBeUndefined()
        expect(leakedMarker('```\n<tool_call>\n```\n<tool_call>')).toBe('<tool_call>')
        expect(leakedMarker('const tag = /<tool_call\\b[^>]*>/i')).toBeUndefined()
        expect(
            leakedMarker('EVIDENCE:\nif (text.includes("<function=read>")) <parameter=x>')
        ).toBeUndefined()
    })
})

describe('createLeak', () => {
    test('trips on the final message of a clean run', () => {
        const onTrip = trip()
        const guard = createLeak(onTrip)
        guard.onEvent(turnStart)
        guard.onEvent(agentEnd([{role: 'user'}, assistant('<tool_call>{}</tool_call>')]))

        expect(onTrip).toHaveBeenCalledWith({
            id: 'leak',
            hint: expect.stringContaining('plain text (<tool_call>)')
        })
        guard.dispose()
    })

    test('catches markup that opens a later text block', () => {
        const onTrip = trip()
        const guard = createLeak(onTrip)
        guard.onEvent(
            agentEnd([
                {
                    role: 'assistant',
                    content: [
                        {type: 'text', text: 'Let me read it.'},
                        {type: 'thinking', thinking: 'read'},
                        {type: 'text', text: '<tool_call>{}</tool_call>'}
                    ],
                    stopReason: 'stop'
                }
            ])
        )

        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('ignores clean text, cut-off or failed runs and runs with no assistant message', () => {
        const onTrip = trip()
        const guard = createLeak(onTrip)
        guard.onEvent(agentEnd([assistant('done')]))
        guard.onEvent(agentEnd([assistant('<tool_call>', 'error')]))
        guard.onEvent(agentEnd([assistant('<tool_call>', 'aborted')]))
        guard.onEvent(agentEnd([assistant('<tool_call>', 'length')]))
        guard.onEvent(agentEnd([{role: 'user'}]))

        expect(onTrip).not.toHaveBeenCalled()
    })
})
