import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import type {ExtensionAPI, SessionStats, ToolDefinition} from '@earendil-works/pi-coding-agent'
import type {AssistantMessage, StopReason} from '@earendil-works/pi-ai'
import type {TObject, TString} from 'typebox'
import {rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {agentDir, getAgentDir, useAgentDir} from '../agentDir'
import type {SubagentDetails, SubagentProgress} from '../../src/subagent/subagent'

type FakeMessage = Pick<
    AssistantMessage,
    'role' | 'model' | 'provider' | 'stopReason' | 'timestamp' | 'content' | 'usage'
> & {
    errorMessage?: string
}

type FakeSession = {
    messages: Array<FakeMessage | {role: 'user'}>
    text: string | undefined
    onPrompt: () => Promise<void>
    prompt: ReturnType<typeof mock>
    abort: ReturnType<typeof mock>
    dispose: ReturnType<typeof mock>
    getLastAssistantText: ReturnType<typeof mock>
    getSessionStats: ReturnType<typeof mock>
    subscribe: ReturnType<typeof mock>
    unsubscribe: ReturnType<typeof mock>
    emit: (event: {type: string; message?: unknown}) => void
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
        text: 'hello',
        onPrompt: () => Promise.resolve(),
        prompt: mock(() => session.onPrompt()),
        abort: mock(() => Promise.resolve()),
        dispose: mock(() => undefined),
        getLastAssistantText: mock(() => session.text),
        getSessionStats: mock(() => stats),
        subscribe: mock((listener: (event: {type: string}) => void) => {
            listeners.push(listener)
            return unsubscribe
        }),
        unsubscribe,
        emit: event => {
            for (const listener of listeners) listener(event)
        },
        emitAssistant: () => {
            const last = session.messages.findLast(message => message.role === 'assistant')
            session.emit({type: 'message_end', message: last})
        }
    }
    return session
}

const noProgress: SubagentProgress = () => undefined

let session = makeSession()
let onReload: () => Promise<void> = () => Promise.resolve()
const reload = mock(() => onReload())
const loaderOptions = mock((_options: unknown) => undefined)
const createAgentSession = mock(() => Promise.resolve({session}))
const sessionManager = {kind: 'in-memory'}
const settingsManager = {kind: 'settings'}
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
    progressThrottleMs,
    runSubagent,
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

// Progress snapshots fold in the message that just ended (see withPending).
const pendingStats: SessionStats = {
    ...stats,
    assistantMessages: 2,
    totalMessages: 3,
    tokens: {input: 14, output: 7, cacheRead: 1, cacheWrite: 0, total: 22},
    cost: 0.5
}

const expectedDetails = {
    ...stats,
    model: 'fake-model',
    provider: 'fake-provider',
    stopReason: 'stop' as const,
    timestamp: 1700000000000,
    task: 'task',
    lastAssistantText: 'hello',
    elapsedMs: 0
}
describe('runSubagent', () => {
    test('returns text and details on a clean stop', async () => {
        const result = await runSubagent('task', undefined, noProgress)
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
            resourceLoader: expect.any(Object),
            tools: [],
            thinkingLevel: 'high',
            model: undefined
        })
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

    test('uses read-only tools and the process cwd by default', async () => {
        await runSubagent('task', undefined, noProgress)

        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({
                cwd: process.cwd(),
                tools: ['read', 'grep', 'find', 'ls'],
                thinkingLevel: undefined
            })
        )
        expect(loaderOptions).toHaveBeenCalledWith(expect.objectContaining({systemPrompt: ''}))
    })

    test('reads the last assistant message, not the first', async () => {
        session.messages = [
            assistant({model: 'first', stopReason: 'toolUse'}),
            {role: 'user'},
            assistant({model: 'second'})
        ]

        const result = await runSubagent('task', undefined, noProgress)
        expect(result.details.model).toBe('second')
        expect(result.details.stopReason).toBe('stop')
    })

    test('streams the text as it stood, one snapshot per throttle window', async () => {
        const seen: SubagentDetails[] = []
        session.text = 'partial'

        session.onPrompt = () => {
            session.emitAssistant()
            session.emit({type: 'tool_execution_end'})
            session.text = 'hello'
            session.emitAssistant()
            return Promise.resolve()
        }

        const result = await runSubagent('task', undefined, details => {
            seen.push(details)
        })
        expect(seen).toEqual([{...expectedDetails, ...pendingStats, lastAssistantText: 'partial'}])
        expect(result.details).toEqual(expectedDetails)
        expect(session.unsubscribe).toHaveBeenCalledTimes(1)
    })

    test('streams again once the throttle window passes', async () => {
        const seen: SubagentDetails[] = []
        session.text = 'first'

        session.onPrompt = () => {
            session.emitAssistant()
            session.emitAssistant()
            clock += progressThrottleMs
            session.text = 'second'
            session.emitAssistant()
            return Promise.resolve()
        }

        await runSubagent('task', undefined, details => {
            seen.push(details)
        })

        expect(seen.map(details => details.lastAssistantText)).toEqual(['first', 'second'])
    })

    test('counts the tool calls of the message that just ended', async () => {
        const seen: SubagentDetails[] = []
        session.messages.push(
            assistant({content: [{type: 'toolCall', id: '1', name: 'read', arguments: {}}]})
        )

        session.onPrompt = () => {
            session.emitAssistant()
            return Promise.resolve()
        }

        await runSubagent('task', undefined, details => {
            seen.push(details)
        })

        expect(seen.map(details => details.toolCalls)).toEqual([1])
    })

    test('keeps the last text when a tool-only turn has none', async () => {
        const seen: SubagentDetails[] = []
        session.text = 'checking'

        session.onPrompt = () => {
            session.emitAssistant()
            clock += progressThrottleMs
            session.text = undefined
            session.emitAssistant()
            session.text = 'hello'
            return Promise.resolve()
        }

        await runSubagent('task', undefined, details => {
            seen.push(details)
        })

        expect(seen.map(details => details.lastAssistantText)).toEqual(['checking', 'checking'])
    })

    test('ignores message_end for messages the subagent did not author', async () => {
        const seen: SubagentDetails[] = []
        session.onPrompt = () => {
            session.emit({type: 'message_end', message: {role: 'user'}})
            session.emit({type: 'message_end', message: {role: 'toolResult'}})
            return Promise.resolve()
        }

        await runSubagent('task', undefined, details => {
            seen.push(details)
        })

        expect(seen).toHaveLength(0)
    })

    test('measures elapsed from the start of the run', async () => {
        const seen: SubagentDetails[] = []
        session.onPrompt = () => {
            clock += 250
            session.emitAssistant()
            clock += 1_000
            return Promise.resolve()
        }

        const result = await runSubagent('task', undefined, details => {
            seen.push(details)
        })
        expect(seen.map(details => details.elapsedMs)).toEqual([250])
        expect(result.details.elapsedMs).toBe(1_250)
    })

    test('throws before creating a session when the signal is already aborted', async () => {
        const controller = new AbortController()
        controller.abort()

        await expect(runSubagent('task', controller.signal, noProgress)).rejects.toThrow(
            'Subagent aborted'
        )
        expect(loaderOptions).not.toHaveBeenCalled()
        expect(createAgentSession).not.toHaveBeenCalled()
    })

    test('throws before prompting when the signal fires during setup', async () => {
        const controller = new AbortController()
        onReload = () => {
            controller.abort()
            return Promise.resolve()
        }

        await expect(runSubagent('task', controller.signal, noProgress)).rejects.toThrow(
            'Subagent aborted'
        )
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

        await expect(runSubagent('task', controller.signal, noProgress)).rejects.toThrow(
            'Subagent aborted'
        )
        expect(session.abort).toHaveBeenCalledTimes(1)
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('removes the abort listener after a successful run', async () => {
        const controller = new AbortController()
        await runSubagent('task', controller.signal, noProgress)
        controller.abort()

        expect(session.abort).not.toHaveBeenCalled()
    })

    test('removes the abort listener after a failed run', async () => {
        const controller = new AbortController()
        session.onPrompt = () => Promise.reject(new Error('network down'))

        await expect(runSubagent('task', controller.signal, noProgress)).rejects.toThrow(
            'network down'
        )
        controller.abort()

        expect(session.abort).not.toHaveBeenCalled()
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test.each<StopReason>(['length', 'toolUse', 'pending', 'deferred'])(
        'returns the text when the stop reason is %s',
        async stopReason => {
            session.messages = [assistant({stopReason})]

            const result = await runSubagent('task', undefined, noProgress)
            expect(result.text).toBe('hello')
            expect(result.details.stopReason).toBe(stopReason)
        }
    )

    test('throws when there is no assistant message', async () => {
        session.messages = [{role: 'user'}]

        await expect(runSubagent('task', undefined, noProgress)).rejects.toThrow(
            'Empty model output'
        )
        expect(session.getLastAssistantText).not.toHaveBeenCalled()
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('throws with the error message when the run errors', async () => {
        session.messages = [assistant({stopReason: 'error', errorMessage: 'boom'})]

        await expect(runSubagent('task', undefined, noProgress)).rejects.toThrow(
            'Subagent run failed: boom'
        )
        expect(session.dispose).toHaveBeenCalledTimes(1)
    })

    test('throws with the stop reason when the run is aborted without a message', async () => {
        session.messages = [assistant({stopReason: 'aborted'})]

        await expect(runSubagent('task', undefined, noProgress)).rejects.toThrow(
            'Subagent run failed: aborted'
        )
    })

    test('throws when the assistant text is missing', async () => {
        session.text = undefined

        await expect(runSubagent('task', undefined, noProgress)).rejects.toThrow(
            'Empty model output'
        )
        expect(session.dispose).toHaveBeenCalledTimes(1)
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
        saveConfig({thinkingLevel: 'high'})

        await registeredTool().execute('id', {task: 'task'}, undefined, undefined, ctx('/fake/cwd'))

        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({thinkingLevel: 'high', model: hostModel})
        )
    })

    test('resolves the saved model through the registry', async () => {
        saveConfig({model: 'acme/fast', thinkingLevel: 'low'})

        await registeredTool().execute('id', {task: 'task'}, undefined, undefined, ctx('/fake/cwd'))

        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({thinkingLevel: 'low', model: registryModel})
        )
    })

    test('falls back to the host model when the saved one is unknown', async () => {
        saveConfig({model: 'acme/gone', thinkingLevel: 'low'})

        await registeredTool().execute('id', {task: 'task'}, undefined, undefined, ctx('/fake/cwd'))

        expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({model: hostModel}))
    })

    test('forwards subagent progress to the tool update callback', async () => {
        const tool = registeredTool()
        const updates: Array<{text: string; task: string}> = []
        session.onPrompt = () => {
            session.emitAssistant()
            return Promise.resolve()
        }

        await tool.execute(
            'id',
            {task: 'find the bug'},
            undefined,
            partial => {
                const [content] = partial.content
                updates.push({
                    text: content?.type === 'text' ? content.text : '',
                    task: (partial.details as SubagentDetails).task
                })
            },
            ctx('/fake/cwd')
        )

        expect(updates).toEqual([{text: 'hello', task: 'find the bug'}])
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
})
