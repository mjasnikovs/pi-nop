import {afterAll, beforeEach, describe, expect, jest, mock, test} from 'bun:test'
import type {ExtensionAPI, SessionStats, ToolDefinition} from '@earendil-works/pi-coding-agent'
import type {AssistantMessage, StopReason} from '@earendil-works/pi-ai'
import type {TObject, TString} from 'typebox'
import {rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {agentDir, getAgentDir, useAgentDir} from '../agentDir'
import type {SubagentDetails, SubagentOptions, SubagentUpdate} from '../../src/subagent/subagent'
import type {SubagentProgress} from '../../src/subagent/progress'

type FakeMessage = Pick<
    AssistantMessage,
    'role' | 'model' | 'provider' | 'stopReason' | 'timestamp' | 'content' | 'usage'
> & {
    errorMessage?: string
}

type FakeSession = {
    messages: Array<FakeMessage | {role: 'user'}>
    onPrompt: () => Promise<void>
    prompt: ReturnType<typeof mock>
    abort: ReturnType<typeof mock>
    dispose: ReturnType<typeof mock>
    getSessionStats: ReturnType<typeof mock>
    subscribe: ReturnType<typeof mock>
    unsubscribe: ReturnType<typeof mock>
    sessionManager: {
        getLeafId: ReturnType<typeof mock>
        branch: ReturnType<typeof mock>
        resetLeaf: ReturnType<typeof mock>
    }
    agent: {state: {messages: unknown[]}}
    emit: (event: {type: string} & Record<string, unknown>) => void
    emitAssistant: () => void
}

type SubagentTool = ToolDefinition<TObject<{task: TString}>>

const stats: SessionStats = {
    sessionFile: undefined,
    sessionId: 'fake-session',
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 2,
    tokens: {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15},
    cost: 0
}

const usage: AssistantMessage['usage'] = {
    input: 4,
    output: 2,
    cacheRead: 1,
    cacheWrite: 0,
    totalTokens: 7,
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5}
}

const assistant = (overrides: Partial<FakeMessage> = {}): FakeMessage => ({
    role: 'assistant',
    model: 'fake-model',
    provider: 'fake-provider',
    stopReason: 'stop',
    timestamp: 1700000000000,
    content: [{type: 'text', text: 'hello'}],
    usage,
    ...overrides
})

const makeSession = (): FakeSession => {
    const listeners: Array<(event: {type: string}) => void> = []
    const unsubscribe = mock(() => undefined)
    const session: FakeSession = {
        messages: [{role: 'user'}, assistant()],
        onPrompt: () => Promise.resolve(),
        // pi ends every prompt with a turn_end for the answer, so the fake does too.
        prompt: mock(async () => {
            await session.onPrompt()
            session.emitAssistant()
        }),
        abort: mock(() => Promise.resolve()),
        dispose: mock(() => undefined),
        getSessionStats: mock(() => stats),
        subscribe: mock((listener: (event: {type: string}) => void) => {
            listeners.push(listener)
            return () => {
                unsubscribe()
                listeners.splice(listeners.indexOf(listener), 1)
            }
        }),
        unsubscribe,
        sessionManager: {
            getLeafId: mock(() => 'leaf-1'),
            branch: mock((_id: string) => undefined),
            resetLeaf: mock(() => undefined)
        },
        agent: {state: {messages: [{role: 'user'}]}},
        emit: event => {
            for (const listener of listeners) listener(event)
        },
        emitAssistant: () => {
            const last = session.messages.findLast(message => message.role === 'assistant')
            if (last !== undefined) session.emit({type: 'turn_end', message: last})
        }
    }
    return session
}

const noProgress: SubagentUpdate = undefined

let session = makeSession()
let onReload: () => Promise<void> = () => Promise.resolve()
const reload = mock(() => onReload())
const loaderOptions = mock((_options: unknown) => undefined)
const createAgentSession = mock(() => Promise.resolve({session}))
const sessionManager = {kind: 'in-memory'}
const applyOverrides = mock((_overrides: unknown) => undefined)
const settingsManager = {kind: 'settings', applyOverrides}
const inMemory = mock((_cwd: string) => sessionManager)
const settingsCreate = mock((_cwd: string, _agentDir: string) => settingsManager)
const actual = await import('@earendil-works/pi-coding-agent')
await mock.module('@earendil-works/pi-coding-agent', () => ({
    ...actual,
    createAgentSession,
    DefaultResourceLoader: class {
        constructor(options: unknown) {
            loaderOptions(options)
        }
        reload = reload
    },
    getAgentDir,
    SessionManager: {inMemory},
    SettingsManager: {create: settingsCreate}
}))

const {saveConfig} = await import('../../src/config/config')
const configPath = join(agentDir, 'pi-nop.json')
const realNow = performance.now.bind(performance)
let clock = 1_000
afterAll(() => {
    performance.now = realNow
    mock.restore()
})

const {
    registerSubagentTool,
    runSubagent,
    subagentSession,
    default: register
} = await import('../../src/subagent/subagent')
useAgentDir()

beforeEach(() => {
    clock = 1_000
    performance.now = () => clock
    session = makeSession()
    onReload = () => Promise.resolve()
    reload.mockClear()
    loaderOptions.mockClear()
    createAgentSession.mockClear()
    inMemory.mockClear()
    settingsCreate.mockClear()
    getAgentDir.mockClear()
    rmSync(configPath, {force: true})
})

const sessionOptions: SubagentOptions = {cwd: '/opt/cwd', prompt: '', tools: []}

const expectedDetails = {
    ...stats,
    model: 'fake-model',
    provider: 'fake-provider',
    stopReason: 'stop' as const,
    timestamp: 1700000000000,
    task: 'task',
    lastAssistantText: 'hello',
    elapsedMs: 0,
    restarts: 0
}
describe('runSubagent', () => {
    test('returns text and details on a clean stop', async () => {
        const result = await runSubagent('task', undefined, noProgress, sessionOptions)
        expect(result).toEqual({text: 'hello', details: expectedDetails})
        expect(session.prompt).toHaveBeenCalledTimes(1)
        expect(session.prompt).toHaveBeenCalledWith('task', {expandPromptTemplates: false})
        expect(session.abort).not.toHaveBeenCalled()
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('builds an isolated in-memory session from the options', async () => {
        await runSubagent('task', undefined, noProgress, {
            cwd: '/opt/cwd',
            prompt: 'system prompt',
            tools: [],
            thinkingLevel: 'high'
        })

        expect(settingsCreate).toHaveBeenCalledWith('/opt/cwd', agentDir)
        expect(applyOverrides).toHaveBeenCalledWith({compaction: {enabled: false}})
        expect(loaderOptions).toHaveBeenCalledTimes(1)
        expect(loaderOptions).toHaveBeenCalledWith({
            cwd: '/opt/cwd',
            agentDir: agentDir,
            settingsManager,
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            systemPrompt: 'system prompt'
        })
        expect(reload).toHaveBeenCalledTimes(1)
        expect(inMemory).toHaveBeenCalledWith('/opt/cwd')
        expect(createAgentSession).toHaveBeenCalledTimes(1)
        expect(createAgentSession).toHaveBeenCalledWith({
            cwd: '/opt/cwd',
            sessionManager,
            settingsManager,
            resourceLoader: expect.any(Object),
            tools: [],
            customTools: [],
            thinkingLevel: 'high',
            model: undefined
        })
    })

    test('a custom tool is passed on and its name joins the allowlist', async () => {
        const askUser = {name: 'ask_user'} as unknown as NonNullable<
            Parameters<typeof runSubagent>[3]['customTools']
        >[number]
        await runSubagent('task', undefined, noProgress, {
            ...sessionOptions,
            customTools: [askUser]
        })

        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({
                tools: [...sessionOptions.tools, 'ask_user'],
                customTools: [askUser]
            })
        )
    })

    test('forwards an explicit model', async () => {
        const model = {id: 'fake'} as unknown as NonNullable<
            Parameters<typeof runSubagent>[3]
        >['model']
        await runSubagent('task', undefined, noProgress, {
            cwd: '/opt/cwd',
            prompt: '',
            tools: [],
            thinkingLevel: 'low',
            model
        })

        expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({model}))
    })

    test('reads the last assistant message, not the first', async () => {
        session.messages = [
            assistant({model: 'first', stopReason: 'toolUse'}),
            {role: 'user'},
            assistant({model: 'second'})
        ]

        const result = await runSubagent('task', undefined, noProgress, sessionOptions)
        expect(result.details.model).toBe('second')
        expect(result.details.stopReason).toBe('stop')
    })

    test('sends one update per assistant turn', async () => {
        const seen: Array<SubagentDetails | undefined> = []
        session.onPrompt = () => {
            session.messages = [assistant({content: [{type: 'text', text: 'partial'}]})]
            session.emitAssistant()
            session.messages = [assistant()]
            return Promise.resolve()
        }

        const result = await runSubagent(
            'task',
            undefined,
            update => {
                if (update.type === 'turn') seen.push(update.details)
            },
            sessionOptions
        )
        expect(seen).toEqual([{...expectedDetails, lastAssistantText: 'partial'}, expectedDetails])
        expect(result.details).toEqual(expectedDetails)
        expect(session.unsubscribe).toHaveBeenCalledTimes(2)
    })

    test('keeps the last text when a tool-only turn has none', async () => {
        const seen: Array<SubagentDetails | undefined> = []
        session.onPrompt = () => {
            session.messages = [assistant({content: [{type: 'text', text: 'checking'}]})]
            session.emitAssistant()
            session.messages = [assistant({content: [], stopReason: 'toolUse'})]
            session.emitAssistant()
            session.messages = [assistant()]
            return Promise.resolve()
        }

        await runSubagent(
            'task',
            undefined,
            update => {
                if (update.type === 'turn') seen.push(update.details)
            },
            sessionOptions
        )

        expect(seen.map(details => details?.lastAssistantText)).toEqual([
            'checking',
            'checking',
            'hello'
        ])
    })

    test('ignores turn_end for messages the subagent did not author', async () => {
        const seen: Array<SubagentDetails | undefined> = []
        session.onPrompt = () => {
            session.emit({type: 'turn_end', message: {role: 'user'}})
            session.emit({type: 'turn_end', message: {role: 'toolResult'}})
            return Promise.resolve()
        }

        await runSubagent(
            'task',
            undefined,
            update => {
                if (update.type === 'turn') seen.push(update.details)
            },
            sessionOptions
        )

        expect(seen).toEqual([expectedDetails])
    })

    test('measures elapsed from the start of the run', async () => {
        const seen: Array<SubagentDetails | undefined> = []
        session.onPrompt = () => {
            clock += 250
            session.emitAssistant()
            clock += 1_000
            return Promise.resolve()
        }

        const result = await runSubagent(
            'task',
            undefined,
            update => {
                if (update.type === 'turn') seen.push(update.details)
            },
            sessionOptions
        )
        expect(seen.map(details => details?.elapsedMs)).toEqual([250, 1_250])
        expect(result.details.elapsedMs).toBe(1_250)
    })

    test('throws before creating a session when the signal is already aborted', async () => {
        const controller = new AbortController()
        controller.abort()

        await expect(
            runSubagent('task', controller.signal, noProgress, sessionOptions)
        ).rejects.toThrow('Subagent aborted')
        expect(loaderOptions).not.toHaveBeenCalled()
        expect(createAgentSession).not.toHaveBeenCalled()
    })

    test('throws before prompting when the signal fires during setup', async () => {
        const controller = new AbortController()
        onReload = () => {
            controller.abort()
            return Promise.resolve()
        }

        await expect(
            runSubagent('task', controller.signal, noProgress, sessionOptions)
        ).rejects.toThrow('Subagent aborted')
        expect(session.prompt).not.toHaveBeenCalled()
        expect(session.abort).not.toHaveBeenCalled()
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('aborts the session and throws when the signal fires during the prompt', async () => {
        const controller = new AbortController()
        session.onPrompt = () => {
            controller.abort()
            return Promise.resolve()
        }

        await expect(
            runSubagent('task', controller.signal, noProgress, sessionOptions)
        ).rejects.toThrow('Subagent aborted')
        expect(session.abort).toHaveBeenCalledTimes(1)
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('removes the abort listener after a successful run', async () => {
        const controller = new AbortController()
        await runSubagent('task', controller.signal, noProgress, sessionOptions)
        controller.abort()

        expect(session.abort).not.toHaveBeenCalled()
    })

    test('removes the abort listener after a failed run', async () => {
        const controller = new AbortController()
        session.onPrompt = () => Promise.reject(new Error('network down'))

        await expect(
            runSubagent('task', controller.signal, noProgress, sessionOptions)
        ).rejects.toThrow('network down')
        controller.abort()

        expect(session.abort).not.toHaveBeenCalled()
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('aborts and throws when pi compacts the session', async () => {
        session.onPrompt = () => {
            session.emit({type: 'compaction_start'})
            return Promise.resolve()
        }

        await expect(runSubagent('task', undefined, noProgress, sessionOptions)).rejects.toThrow(
            'Subagent context was compacted'
        )
        expect(session.abort).toHaveBeenCalledTimes(1)
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('throws when the model ran out of output', async () => {
        session.messages = [assistant({stopReason: 'length'})]

        await expect(runSubagent('task', undefined, noProgress, sessionOptions)).rejects.toThrow(
            'Subagent output cut off at the model output limit'
        )
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test.each<StopReason>(['toolUse', 'pending', 'deferred'])(
        'returns the text when the stop reason is %s',
        async stopReason => {
            session.messages = [assistant({stopReason})]

            const result = await runSubagent('task', undefined, noProgress, sessionOptions)
            expect(result.text).toBe('hello')
            expect(result.details.stopReason).toBe(stopReason)
        }
    )

    test('throws when there is no assistant message', async () => {
        session.messages = [{role: 'user'}]

        await expect(runSubagent('task', undefined, noProgress, sessionOptions)).rejects.toThrow(
            'Empty model output'
        )
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('throws with the error message when the run errors', async () => {
        session.messages = [assistant({stopReason: 'error', errorMessage: 'boom'})]

        await expect(runSubagent('task', undefined, noProgress, sessionOptions)).rejects.toThrow(
            'Subagent run failed: boom'
        )
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('throws with the stop reason when the run is aborted without a message', async () => {
        session.messages = [assistant({stopReason: 'aborted'})]

        await expect(runSubagent('task', undefined, noProgress, sessionOptions)).rejects.toThrow(
            'Subagent run failed: aborted'
        )
    })

    test('throws when the assistant text is missing', async () => {
        session.messages = [assistant({content: [{type: 'text', text: '  '}]})]

        await expect(runSubagent('task', undefined, noProgress, sessionOptions)).rejects.toThrow(
            'Empty model output (stop; blocks: text)'
        )
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })
})

describe('subagentSession', () => {
    const answer = (text: string) => {
        session.messages.push({role: 'user'}, assistant({content: [{type: 'text', text}]}))
    }
    test('two prompts share one pi session and keep it open', async () => {
        const handle = subagentSession(sessionOptions)
        expect((await handle.prompt('one', undefined, noProgress)).text).toBe('hello')
        answer('second')
        expect((await handle.prompt('two', undefined, noProgress)).text).toBe('second')

        expect(createAgentSession).toHaveBeenCalledTimes(1)
        expect(session.prompt).toHaveBeenLastCalledWith('two', {expandPromptTemplates: false})
        expect(session.dispose).not.toHaveBeenCalled()

        handle.dispose()
        handle.dispose()
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('a prompt answers only from its own turns', async () => {
        const handle = subagentSession(sessionOptions)
        await handle.prompt('one', undefined, noProgress)
        session.prompt.mockImplementationOnce(() => Promise.resolve())

        await expect(handle.prompt('two', undefined, noProgress)).rejects.toThrow(
            'Empty model output'
        )
    })

    test('an aborted prompt keeps the session for the next one', async () => {
        const handle = subagentSession(sessionOptions)
        const controller = new AbortController()
        session.onPrompt = () => {
            controller.abort()
            return Promise.resolve()
        }

        await expect(handle.prompt('one', controller.signal, noProgress)).rejects.toThrow(
            'Subagent aborted'
        )
        session.onPrompt = () => Promise.resolve()
        answer('after abort')

        expect((await handle.prompt('two', undefined, noProgress)).text).toBe('after abort')
        expect(session.abort).toHaveBeenCalledTimes(1)
        expect(session.dispose).not.toHaveBeenCalled()
        expect(createAgentSession).toHaveBeenCalledTimes(1)
    })

    test('a prompt after dispose throws', async () => {
        const handle = subagentSession(sessionOptions)
        await handle.prompt('one', undefined, noProgress)
        handle.dispose()

        await expect(handle.prompt('two', undefined, noProgress)).rejects.toThrow(
            'Subagent session was closed'
        )
        expect(session.prompt).toHaveBeenCalledTimes(1)
    })

    test('a session that finishes building after dispose is disposed', async () => {
        const handle = subagentSession(sessionOptions)
        onReload = () => {
            handle.dispose()
            return Promise.resolve()
        }

        await expect(handle.prompt('one', undefined, noProgress)).rejects.toThrow(
            'Subagent session was closed'
        )
        expect(session.prompt).not.toHaveBeenCalled()
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('compaction closes the session', async () => {
        const handle = subagentSession(sessionOptions)
        session.onPrompt = () => {
            session.emit({type: 'compaction_start'})
            return Promise.resolve()
        }

        await expect(handle.prompt('one', undefined, noProgress)).rejects.toThrow(
            'Subagent context was compacted'
        )
        expect(session.dispose).toHaveBeenCalledTimes(1)
        await expect(handle.prompt('two', undefined, noProgress)).rejects.toThrow(
            'Subagent session was closed'
        )
    })

    test('a prompt waits for a slot like every other run', async () => {
        saveConfig({concurrency: 1})
        const held: Array<() => void> = []
        session.onPrompt = () => new Promise<void>(resolve => held.push(resolve))
        const handle = subagentSession(sessionOptions)
        const updates: unknown[] = []
        const first = runSubagent('one', undefined, noProgress, sessionOptions)
        const second = handle.prompt('two', undefined, update => updates.push(update))
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(updates).toEqual([{type: 'queued'}])
        expect(session.prompt).toHaveBeenCalledTimes(1)

        held.shift()?.()
        await first
        await new Promise(resolve => setTimeout(resolve, 0))
        held.shift()?.()
        await second
        expect(session.prompt).toHaveBeenLastCalledWith('two', {expandPromptTemplates: false})
    })
})

describe('guards', () => {
    const loopCall = {
        type: 'tool_execution_start',
        toolCallId: 'c',
        toolName: 'ls',
        args: {path: '.'}
    }

    // The model repeats one call until the loop guard aborts it. Then the next prompt answers.
    const loopOnce = () => {
        session.onPrompt = () => {
            for (let i = 0; i < 5; i += 1) session.emit(loopCall)
            session.messages = [assistant({stopReason: 'aborted'})]
            session.agent.state.messages.push({role: 'assistant'})

            session.onPrompt = () => {
                session.messages = [assistant()]
                return Promise.resolve()
            }
            return Promise.resolve()
        }
    }
    test('a loop kill rewinds the session and prompts again with the hint', async () => {
        loopOnce()
        const updates: unknown[] = []
        const result = await runSubagent(
            'task',
            undefined,
            update => updates.push(update),
            sessionOptions
        )
        expect(result.text).toBe('hello')
        expect(result.details.restarts).toBe(1)
        expect(session.abort).toHaveBeenCalledTimes(1)
        expect(session.prompt).toHaveBeenCalledTimes(2)
        const [second] = session.prompt.mock.calls[1] as [string]
        expect(second).toStartWith(
            '[SYSTEM NOTE: Your previous attempt called ls({"path":"."}) 5 times'
        )
        expect(second).toEndWith('\n\ntask')
        expect(session.sessionManager.branch).toHaveBeenCalledWith('leaf-1')
        expect(session.sessionManager.resetLeaf).not.toHaveBeenCalled()
        expect(session.agent.state.messages).toEqual([{role: 'user'}])
        expect(updates).toEqual([
            {type: 'started'},
            {
                type: 'turn',
                text: 'hello',
                details: {...expectedDetails, stopReason: 'aborted', lastAssistantText: 'hello'}
            },
            {type: 'restarting', guard: 'loop'},
            {type: 'turn', text: 'hello', details: {...expectedDetails, restarts: 1}}
        ])
        expect(createAgentSession).toHaveBeenCalledTimes(1)
    })

    test('a task function is read again for the restart', async () => {
        loopOnce()
        const tasks = ['first', 'second']
        const result = await subagentSession(sessionOptions).prompt(
            () => tasks.shift() ?? '',
            undefined,
            noProgress
        )
        expect(session.prompt.mock.calls[0][0]).toBe('first')
        expect(session.prompt.mock.calls[1][0]).toEndWith('\n\nsecond')
        expect(result.details.task).toBe('second')
    })

    test('the third attempt carries the second hint only, not the first', async () => {
        session.onPrompt = () => {
            for (let i = 0; i < 5; i += 1) session.emit(loopCall)
            session.messages = [assistant({stopReason: 'aborted'})]

            session.onPrompt = () => {
                for (let i = 0; i < 8; i += 1) {
                    session.emit({...loopCall, toolCallId: `e${i}`, args: {path: `m${i}`}})
                    session.emit({
                        type: 'tool_execution_end',
                        toolCallId: `e${i}`,
                        toolName: 'ls',
                        result: {content: []},
                        isError: true
                    })
                }

                session.messages = [assistant({stopReason: 'aborted'})]

                session.onPrompt = () => {
                    session.messages = [assistant()]
                    return Promise.resolve()
                }
                return Promise.resolve()
            }
            return Promise.resolve()
        }

        const result = await runSubagent('task', undefined, noProgress, sessionOptions)
        expect(result.details.restarts).toBe(2)
        const [third] = session.prompt.mock.calls[2] as [string]
        expect(third).toStartWith('[SYSTEM NOTE: Your previous attempt made 8 tool calls')
        expect(third).not.toContain('5 times')
        expect(third).toEndWith('\n\ntask')
    })

    test('compaction during a tripped attempt is reported as compaction', async () => {
        session.onPrompt = () => {
            for (let i = 0; i < 5; i += 1) session.emit(loopCall)
            session.emit({type: 'compaction_start'})
            session.messages = [assistant({stopReason: 'aborted'})]
            return Promise.resolve()
        }

        await expect(runSubagent('task', undefined, noProgress, sessionOptions)).rejects.toThrow(
            'Subagent context was compacted'
        )
        expect(session.prompt).toHaveBeenCalledTimes(1)
        expect(session.sessionManager.branch).not.toHaveBeenCalled()
    })

    test('dispose during a tripped attempt is reported as closed, with no rewind', async () => {
        const handle = subagentSession(sessionOptions)
        session.onPrompt = () => {
            for (let i = 0; i < 5; i += 1) session.emit(loopCall)
            handle.dispose()
            session.messages = [assistant({stopReason: 'aborted'})]
            return Promise.resolve()
        }

        await expect(handle.prompt('task', undefined, noProgress)).rejects.toThrow(
            'Subagent session was closed'
        )
        expect(session.prompt).toHaveBeenCalledTimes(1)
        expect(session.sessionManager.branch).not.toHaveBeenCalled()
    })

    test('a session with no entries yet is rewound to its root', async () => {
        loopOnce()
        session.sessionManager.getLeafId.mockReturnValueOnce(null)
        await runSubagent('task', undefined, noProgress, sessionOptions)

        expect(session.sessionManager.resetLeaf).toHaveBeenCalledTimes(1)
        expect(session.sessionManager.branch).not.toHaveBeenCalled()
    })

    test('fails once the restarts are spent', async () => {
        saveConfig({restarts: 1})

        session.onPrompt = () => {
            for (let i = 0; i < 5; i += 1) session.emit(loopCall)
            session.messages = [assistant({stopReason: 'aborted'})]
            return Promise.resolve()
        }

        await expect(runSubagent('task', undefined, noProgress, sessionOptions)).rejects.toThrow(
            'Subagent killed by the guard: loop'
        )
        expect(session.prompt).toHaveBeenCalledTimes(2)
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('with restarts at 0 the guards still kill, on the first hit', async () => {
        saveConfig({restarts: 0})
        loopOnce()

        await expect(runSubagent('task', undefined, noProgress, sessionOptions)).rejects.toThrow(
            'Subagent killed by the guard: loop'
        )
        expect(session.prompt).toHaveBeenCalledTimes(1)
        expect(session.sessionManager.branch).not.toHaveBeenCalled()
    })

    test('a caller abort during a killed attempt is reported as an abort', async () => {
        const controller = new AbortController()
        session.onPrompt = () => {
            for (let i = 0; i < 5; i += 1) session.emit(loopCall)
            controller.abort()
            session.messages = [assistant({stopReason: 'aborted'})]
            return Promise.resolve()
        }

        await expect(
            runSubagent('task', controller.signal, noProgress, sessionOptions)
        ).rejects.toThrow('Subagent aborted')
        expect(session.prompt).toHaveBeenCalledTimes(1)
    })

    describe('a tool call that takes an hour', () => {
        const waited = {type: 'tool_execution_start', toolCallId: 'q', toolName: 'ask_user'}
        const hour = 60 * 60_000

        const waitOnce = () => {
            session.onPrompt = () => {
                session.emit({...waited, args: {question: 'which?'}})
                jest.advanceTimersByTime(hour)
                session.messages = [assistant()]
                return Promise.resolve()
            }
        }
        test('is left alone when the tool waits on the user', async () => {
            jest.useFakeTimers()
            waitOnce()
            const result = await runSubagent('task', undefined, noProgress, {
                ...sessionOptions,
                waitingTools: ['ask_user']
            }).finally(() => jest.useRealTimers())
            expect(session.abort).not.toHaveBeenCalled()
            expect(result.details.restarts).toBe(0)
        })

        test('trips the tool-call guard for any other tool', async () => {
            jest.useFakeTimers()
            waitOnce()
            const run = runSubagent('task', undefined, noProgress, sessionOptions).finally(() =>
                jest.useRealTimers()
            )
            await expect(run).rejects.toThrow('Subagent killed by the guard: tool-call')
        })
    })

    test('a restart keeps the slot it holds', async () => {
        saveConfig({concurrency: 1})
        loopOnce()
        const first = runSubagent('one', undefined, noProgress, sessionOptions)
        const second = runSubagent('two', undefined, noProgress, sessionOptions)
        await first
        expect(createAgentSession).toHaveBeenCalledTimes(1)
        expect(session.prompt).toHaveBeenCalledTimes(2)

        await second
        expect(createAgentSession).toHaveBeenCalledTimes(2)
    })

    test('the context window comes from the session model', async () => {
        ;(session as unknown as {model: unknown}).model = {contextWindow: 10}

        session.onPrompt = () => {
            session.emit({
                type: 'tool_execution_end',
                toolCallId: 'c',
                toolName: 'read',
                result: {content: [{type: 'text', text: 'x'.repeat(100)}]},
                isError: false
            })
            session.messages = [assistant({stopReason: 'aborted'})]

            session.onPrompt = () => {
                session.messages = [assistant()]
                return Promise.resolve()
            }
            return Promise.resolve()
        }

        const result = await runSubagent('task', undefined, noProgress, sessionOptions)
        expect(result.details.restarts).toBe(1)
        expect((session.prompt.mock.calls[1] as [string])[0]).toContain('context window')
    })
})

describe('send back', () => {
    const note = '[NOTE]'
    const wantsGoal = mock((answer: string) => (answer.startsWith('GOAL:') ? undefined : note))
    const says = (text: string) => assistant({content: [{type: 'text', text}]})
    const thinksOnly = () => assistant({content: [{type: 'thinking', thinking: 'hm'}]})
    const loopCall = {type: 'tool_execution_start', toolCallId: 'c', toolName: 'ls', args: {}}

    // Each prompt ends on the next step and moves the leaf. A function step ends as a kill.
    const answers = (...steps: Array<FakeMessage | (() => void)>) => {
        const {getLeafId, branch} = session.sessionManager
        let leaves = 1
        branch.mockImplementation((leaf: string) => getLeafId.mockReturnValue(leaf))

        session.onPrompt = () => {
            const step = steps.shift()
            if (step === undefined) throw new Error('no answer left')
            if (typeof step === 'function') step()
            session.messages = [
                typeof step === 'function' ? assistant({stopReason: 'aborted'}) : step
            ]
            session.agent.state.messages.push({role: 'assistant'})
            leaves += 1
            getLeafId.mockReturnValue(`leaf-${leaves}`)
            return Promise.resolve()
        }
    }

    const loops = () => {
        for (let i = 0; i < 5; i += 1) session.emit(loopCall)
    }

    const run = (onUpdate: SubagentUpdate = noProgress) =>
        subagentSession(sessionOptions).prompt('task', undefined, onUpdate, wantsGoal)
    beforeEach(() => {
        wantsGoal.mockClear()
    })

    test('a rejected answer gets the note alone, with the conversation kept', async () => {
        answers(says('a list'), says('GOAL: x'))
        const updates: SubagentProgress[] = []
        const result = await run(update => updates.push(update))
        expect(result.text).toBe('GOAL: x')
        expect(result.details.restarts).toBe(1)
        expect(result.details.task).toBe('task')
        expect(session.prompt.mock.calls.map(call => call[0])).toEqual(['task', note])
        expect(wantsGoal.mock.calls).toEqual([['a list'], ['GOAL: x']])
        expect(session.sessionManager.branch).not.toHaveBeenCalled()
        expect(session.agent.state.messages).toHaveLength(3)
        expect(updates.map(update => update.type)).toEqual([
            'started',
            'turn',
            'restarting',
            'turn'
        ])
        expect(updates[2]).toEqual({type: 'restarting', guard: 'answer'})
        expect(
            updates.flatMap(update => (update.type === 'turn' ? [update.details.task] : []))
        ).toEqual(['task', 'task'])
    })

    test('an accepted answer is not sent back', async () => {
        answers(says('GOAL: x'))

        expect((await run()).details.restarts).toBe(0)
        expect(session.prompt).toHaveBeenCalledTimes(1)
    })

    test('the answer is judged as the text the caller gets', async () => {
        const split = assistant({
            content: [
                {type: 'text', text: '\n Here it is.'},
                {type: 'text', text: 'GOAL: x \n'}
            ]
        })
        answers(split)
        const judged = mock((_answer: string) => undefined)
        const result = await subagentSession(sessionOptions).prompt(
            'task',
            undefined,
            noProgress,
            judged
        )
        expect(judged.mock.calls).toEqual([[result.text]])
    })

    test('an empty answer is sent back too', async () => {
        answers(thinksOnly(), says('GOAL: x'))

        expect((await run()).text).toBe('GOAL: x')
        expect(wantsGoal.mock.calls[0]).toEqual([''])
    })

    test('once the restarts are spent the last answer comes back as it is', async () => {
        saveConfig({restarts: 1})
        answers(says('one'), says('two'), says('three'))

        expect((await run()).text).toBe('two')
        expect(session.prompt).toHaveBeenCalledTimes(2)
        expect(wantsGoal).toHaveBeenCalledTimes(1)
    })

    test('an empty last answer still fails', async () => {
        saveConfig({restarts: 1})
        answers(thinksOnly(), thinksOnly())

        await expect(run()).rejects.toThrow('Empty model output (stop; blocks: thinking)')
        expect(session.prompt).toHaveBeenCalledTimes(2)
    })

    test('a kill past the budget fails the run, note pending or not', async () => {
        saveConfig({restarts: 1})
        answers(says('a list'), loops)

        await expect(run()).rejects.toThrow('Subagent killed by the guard: loop')
        expect(session.prompt).toHaveBeenCalledTimes(2)
    })

    test('a kill uses up the budget for a send back too', async () => {
        saveConfig({restarts: 1})
        answers(loops, says('a list'))

        expect((await run()).text).toBe('a list')
        expect(session.prompt).toHaveBeenCalledTimes(2)
    })

    test('a kill of a finished answer wins over the send back', async () => {
        answers(says('<tool_call>\n<function=ls>\n<parameter=path>'), says('GOAL: x'))
        const answer = session.onPrompt
        session.onPrompt = async () => {
            await answer()
            session.emit({type: 'agent_end', messages: session.messages, willRetry: false})
        }

        await run()

        const sent = session.prompt.mock.calls.map(call => call[0] as string)
        expect(sent[1]).toStartWith('[SYSTEM NOTE: Your previous attempt wrote a tool call')
        expect(sent[1]).toEndWith('\n\ntask')
        expect(wantsGoal.mock.calls).toEqual([['GOAL: x']])
    })

    test('with restarts at 0 nothing is sent back', async () => {
        saveConfig({restarts: 0})
        answers(says('a list'))

        expect((await run()).text).toBe('a list')
        expect(session.prompt).toHaveBeenCalledTimes(1)
        expect(wantsGoal).not.toHaveBeenCalled()
    })

    test('a cut-off answer is reported, not sent back', async () => {
        answers(assistant({stopReason: 'length'}))

        await expect(run()).rejects.toThrow('Subagent output cut off')
        expect(wantsGoal).not.toHaveBeenCalled()
    })

    test('a kill after a sent back answer drops its own attempt and sends the note again', async () => {
        answers(says('a list'), loops, says('GOAL: x'))
        const result = await run()
        expect(result.details.restarts).toBe(2)
        const sent = session.prompt.mock.calls.map(call => call[0] as string)
        expect(sent.slice(0, 2)).toEqual(['task', note])
        expect(sent[2]).toStartWith('[SYSTEM NOTE: Your previous attempt called ls(')
        expect(sent[2]).toEndWith(`\n\n${note}`)
        expect(session.sessionManager.branch.mock.calls).toEqual([['leaf-2']])
        expect(session.agent.state.messages).toHaveLength(3)
    })

    test('an answer rejected after a kill gets the note alone', async () => {
        answers(loops, says('a list'), says('GOAL: x'))
        await run()

        const sent = session.prompt.mock.calls.map(call => call[0] as string)
        expect(sent[1]).toEndWith('\n\ntask')
        expect(sent[2]).toBe(note)
        expect(session.sessionManager.branch.mock.calls).toEqual([['leaf-1']])
        expect(session.agent.state.messages).toHaveLength(3)
    })

    test('a failed run is reported, not sent back', async () => {
        answers(assistant({stopReason: 'error', errorMessage: 'boom'}))

        await expect(run()).rejects.toThrow('Subagent run failed: boom')
        expect(wantsGoal).not.toHaveBeenCalled()
    })
})

describe('extension', () => {
    const registerTool = mock((_tool: SubagentTool) => undefined)
    const pi = {registerTool} as unknown as ExtensionAPI

    const registeredTool = (): SubagentTool => {
        registerTool.mockClear()
        register(pi)
        expect(registerTool).toHaveBeenCalledTimes(1)
        const [tool] = registerTool.mock.calls[0] as [SubagentTool]
        return tool
    }

    const registryModel = {provider: 'acme', id: 'fast'}
    const getAvailable = mock(() => [registryModel])
    const hostModel = {provider: 'host', id: 'current'}
    const notify = mock((_message: string, _level: string) => undefined)
    const ctx = (cwd: string) =>
        ({
            cwd,
            model: hostModel,
            thinkingLevel: 'xhigh',
            modelRegistry: {getAvailable},
            ui: {notify}
        }) as unknown as Parameters<SubagentTool['execute']>[4]
    test('warns and uses the host model and thinking level when the config is broken', async () => {
        writeFileSync(configPath, 'nope')

        await registeredTool().execute('id', {task: 'task'}, undefined, undefined, ctx('/fake/cwd'))

        expect(notify).toHaveBeenCalledWith(
            'pi-nop config is broken, using the host model and thinking level. Run /nop-config to fix it.',
            'warning'
        )
        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({thinkingLevel: 'xhigh', model: hostModel})
        )
    })

    test('uses the host model and thinking level when nothing is saved', async () => {
        await registeredTool().execute('id', {task: 'task'}, undefined, undefined, ctx('/fake/cwd'))

        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({thinkingLevel: 'xhigh', model: hostModel})
        )
    })

    test('runs with the saved thinking level and the host model by default', async () => {
        saveConfig({subagent: {thinkingLevel: 'high'}})

        await registeredTool().execute('id', {task: 'task'}, undefined, undefined, ctx('/fake/cwd'))

        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({thinkingLevel: 'high', model: hostModel})
        )
    })

    test('resolves the saved model through the registry', async () => {
        saveConfig({subagent: {model: 'acme/fast', thinkingLevel: 'low'}})

        await registeredTool().execute('id', {task: 'task'}, undefined, undefined, ctx('/fake/cwd'))

        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({thinkingLevel: 'low', model: registryModel})
        )
    })

    test('falls back to the host model when the saved one is unknown', async () => {
        saveConfig({subagent: {model: 'acme/gone', thinkingLevel: 'low'}})

        await registeredTool().execute('id', {task: 'task'}, undefined, undefined, ctx('/fake/cwd'))

        expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({model: hostModel}))
    })

    test('forwards subagent progress to the tool update callback', async () => {
        const tool = registeredTool()
        const updates: Array<{text: string; task: string | undefined}> = []
        await tool.execute(
            'id',
            {task: 'find the bug'},
            undefined,
            partial => {
                const [content] = partial.content
                updates.push({
                    text: content?.type === 'text' ? content.text : '',
                    task: (partial.details as SubagentDetails | undefined)?.task
                })
            },
            ctx('/fake/cwd')
        )

        expect(updates).toEqual([
            {text: '', task: undefined},
            {text: 'hello', task: 'find the bug'}
        ])
    })

    test('registers a read-only subagent tool with a task parameter', () => {
        const tool = registeredTool()
        expect(tool.name).toBe('subagent')
        expect(tool.label).toBe('Subagent')
        expect(tool.description).toContain('read-only')
        expect(tool.description).toContain('USE THIS FIRST')
        expect(tool.parameters.required).toEqual(['task'])
        expect(tool.parameters.properties.task.type).toBe('string')
    })

    test('runs the task in the context cwd and returns the text', async () => {
        const tool = registeredTool()
        const controller = new AbortController()

        const result = await tool.execute(
            'id',
            {task: 'find the bug'},
            controller.signal,
            undefined,
            ctx('/fake/cwd')
        )
        expect(result).toEqual({
            content: [{type: 'text', text: 'hello'}],
            details: {...expectedDetails, task: 'find the bug'}
        })
        expect(session.prompt).toHaveBeenCalledWith('find the bug', {expandPromptTemplates: false})
        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({cwd: '/fake/cwd', tools: ['read', 'grep', 'find', 'ls']})
        )
        expect(inMemory).toHaveBeenCalledWith('/fake/cwd')
    })

    const named = (name: 'subagent' | 'subagent-fetch'): SubagentTool => {
        registerTool.mockClear()
        registerSubagentTool(pi, {
            name,
            label: 'Named',
            description: 'd',
            parameters: {type: 'object', properties: {task: {type: 'string'}}} as never,
            title: () => undefined,
            prepare: (params, _signal, options) =>
                Promise.resolve({task: (params as {task: string}).task, options})
        })
        return registerTool.mock.calls[0][0] as SubagentTool
    }
    test('each tool reads only its own config entry', async () => {
        saveConfig({'subagent-fetch': {model: 'acme/fast', thinkingLevel: 'low'}})

        await named('subagent').execute('id', {task: 'task'}, undefined, undefined, ctx('/c'))
        expect(createAgentSession).toHaveBeenLastCalledWith(
            expect.objectContaining({thinkingLevel: 'xhigh', model: hostModel})
        )

        await named('subagent-fetch').execute('id', {task: 'task'}, undefined, undefined, ctx('/c'))
        expect(createAgentSession).toHaveBeenLastCalledWith(
            expect.objectContaining({thinkingLevel: 'low', model: registryModel})
        )
    })

    test('the fetch tool warns on a broken config too', async () => {
        writeFileSync(configPath, 'nope')

        await named('subagent-fetch').execute('id', {task: 'task'}, undefined, undefined, ctx('/c'))

        expect(notify).toHaveBeenCalledWith(expect.stringContaining('config is broken'), 'warning')
        expect(createAgentSession).toHaveBeenLastCalledWith(
            expect.objectContaining({thinkingLevel: 'xhigh', model: hostModel})
        )
    })

    const verifying = (verify: (text: string) => string): SubagentTool => {
        registerTool.mockClear()
        registerSubagentTool(pi, {
            name: 'subagent',
            label: 'Checked',
            description: 'd',
            parameters: {type: 'object', properties: {task: {type: 'string'}}} as never,
            title: () => undefined,
            prepare: (params, _signal, options) =>
                Promise.resolve({task: (params as {task: string}).task, options, verify})
        })
        return registerTool.mock.calls[0][0] as SubagentTool
    }
    test('returns what verify makes of the answer', async () => {
        const tool = verifying(text => text.toUpperCase())
        const result = await tool.execute('id', {task: 'task'}, undefined, undefined, ctx('/c'))
        expect(result.content).toEqual([{type: 'text', text: 'HELLO'}])
    })

    test('fails the call when verify rejects the answer', async () => {
        const tool = verifying(() => {
            throw new Error('bad answer')
        })
        await expect(
            tool.execute('id', {task: 'task'}, undefined, undefined, ctx('/c'))
        ).rejects.toThrow('bad answer')
    })

    test('passes the signal through so the run can be aborted', async () => {
        const tool = registeredTool()
        const controller = new AbortController()
        session.onPrompt = () => {
            controller.abort()
            return Promise.resolve()
        }

        await expect(
            tool.execute('id', {task: 'task'}, controller.signal, undefined, ctx('/fake/cwd'))
        ).rejects.toThrow('Subagent aborted')
        expect(session.abort).toHaveBeenCalledTimes(1)
    })

    // Every prompt hangs until finish() is called, which frees each one held so far.
    const holdPrompt = (): (() => void) => {
        const held: Array<() => void> = []
        session.onPrompt = () => new Promise<void>(resolve => held.push(resolve))
        return () => {
            for (const resolve of held.splice(0)) resolve()
        }
    }

    const settle = () => new Promise(resolve => setTimeout(resolve, 0))
    test('with a cap the second call waits, tells the tui, and runs after the first', async () => {
        saveConfig({concurrency: 1})
        const tool = registeredTool()
        const finish = holdPrompt()
        const updates: unknown[] = []
        const first = tool.execute('id', {task: 'one'}, undefined, undefined, ctx('/c'))
        const second = tool.execute(
            'id',
            {task: 'two'},
            undefined,
            update => updates.push(update),
            ctx('/c')
        )
        await settle()
        expect(createAgentSession).toHaveBeenCalledTimes(1)
        expect(updates).toEqual([{content: [{type: 'text', text: 'queued…'}], details: undefined}])

        finish()
        await first
        await settle()
        expect(updates).toEqual([
            {content: [{type: 'text', text: 'queued…'}], details: undefined},
            {content: [{type: 'text', text: ''}], details: undefined}
        ])
        finish()
        await second
        expect(createAgentSession).toHaveBeenCalledTimes(2)
        expect(session.prompt).toHaveBeenLastCalledWith('two', {expandPromptTemplates: false})
    })

    test('a queued call that was aborted never opens a session', async () => {
        saveConfig({concurrency: 1})
        const tool = registeredTool()
        const finish = holdPrompt()
        const controller = new AbortController()
        const first = tool.execute('id', {task: 'one'}, undefined, undefined, ctx('/c'))
        const second = tool.execute('id', {task: 'two'}, controller.signal, undefined, ctx('/c'))
        await settle()
        controller.abort()
        finish()

        await first
        await expect(second).rejects.toThrow('Subagent aborted')
        expect(createAgentSession).toHaveBeenCalledTimes(1)
    })

    test('without a cap both calls open a session at once', async () => {
        const tool = registeredTool()
        const finish = holdPrompt()

        const runs = [
            tool.execute('id', {task: 'one'}, undefined, undefined, ctx('/c')),
            tool.execute('id', {task: 'two'}, undefined, undefined, ctx('/c'))
        ]
        await settle()
        expect(createAgentSession).toHaveBeenCalledTimes(2)

        finish()
        await Promise.all(runs)
    })
})
