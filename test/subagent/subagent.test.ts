import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import type {ExtensionAPI, SessionStats, ToolDefinition} from '@earendil-works/pi-coding-agent'
import type {AssistantMessage, StopReason} from '@earendil-works/pi-ai'
import type {TObject, TString} from 'typebox'
import {rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {agentDir, getAgentDir, useAgentDir} from '../agentDir'
import type {SubagentDetails, SubagentOptions, SubagentUpdate} from '../../src/subagent/subagent'

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
            return unsubscribe
        }),
        unsubscribe,
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
    elapsedMs: 0
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
                seen.push(update.details)
            },
            sessionOptions
        )
        expect(seen).toEqual([{...expectedDetails, lastAssistantText: 'partial'}, expectedDetails])
        expect(result.details).toEqual(expectedDetails)
        expect(session.unsubscribe).toHaveBeenCalledTimes(1)
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
                seen.push(update.details)
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
                seen.push(update.details)
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
                seen.push(update.details)
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

        expect(updates).toEqual([{content: [{type: 'text', text: 'queued…'}], details: undefined}])
        expect(session.prompt).toHaveBeenCalledTimes(1)

        held.shift()?.()
        await first
        await new Promise(resolve => setTimeout(resolve, 0))
        held.shift()?.()
        await second
        expect(session.prompt).toHaveBeenLastCalledWith('two', {expandPromptTemplates: false})
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
        const updates: Array<{text: string; task: string}> = []
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
