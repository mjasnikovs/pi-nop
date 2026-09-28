import type {
    AgentSession,
    ExtensionAPI,
    ExtensionContext,
    SessionStats
} from '@earendil-works/pi-coding-agent'
import {
    createAgentSession,
    DefaultResourceLoader,
    getAgentDir,
    SessionManager,
    SettingsManager
} from '@earendil-works/pi-coding-agent'
import type {ThinkingLevel} from '@earendil-works/pi-agent-core'
import type {Api, AssistantMessage, Model} from '@earendil-works/pi-ai'
import {contentText} from '@earendil-works/pi-ai'
import {type Static, type TObject, Type} from 'typebox'

import {
    concurrency,
    findModel,
    inherit,
    modelOf,
    read,
    safeConfig,
    thinkingOf,
    unlimited
} from '../config/config'
import type {NopTool} from '../config/config'
import type {GuardHit} from './guards/guard'
import type {GuardSettings} from './guards/guards'
import {guardSettings, watchGuards} from './guards/guards'
import type {SubagentDetails, SubagentUpdate} from './progress'
import {slots} from './slots'
import {renderCall, renderResult, toolProgress} from './subagentTui'

enum SubagentErrors {
    EmptyOutput = 'Empty model output',
    Aborted = 'Subagent aborted',
    RunFailed = 'Subagent run failed: ',
    NoModel = 'No model selected',
    Truncated = 'Subagent output cut off at the model output limit',
    Compacted = 'Subagent context was compacted, so its answer would not rest on its source',
    Disposed = 'Subagent session was closed',
    Killed = 'Subagent killed by the guard: '
}

enum SubagentTools {
    Read = 'read',
    Grep = 'grep',
    Find = 'find',
    Ls = 'ls'
}

type SubagentOptions = {
    cwd: string
    prompt: string
    tools: SubagentTools[]
    thinkingLevel?: ThinkingLevel
    model?: Model<Api>
}

type SubagentResult = {
    text: string
    details: SubagentDetails
}

type SubagentSession = {
    prompt: (
        task: string,
        signal: AbortSignal | undefined,
        onUpdate: SubagentUpdate
    ) => Promise<SubagentResult>
    dispose: () => void
}

// A cancelled call is reported as such, never as whatever failed underneath it.
const unlessAborted = (signal: AbortSignal | undefined, error: unknown): void => {
    if (signal?.aborted) throw new Error(SubagentErrors.Aborted, {cause: error})
}

const turnText = (message: AssistantMessage): string => contentText(message.content, '').trim()

const buildDetails = (
    stats: SessionStats,
    task: string,
    last: AssistantMessage,
    lastAssistantText: string,
    startedAt: number,
    restarts: number
): SubagentDetails => ({
    ...stats,
    model: last.model,
    provider: last.provider,
    stopReason: last.stopReason,
    timestamp: last.timestamp,
    task,
    lastAssistantText,
    elapsedMs: performance.now() - startedAt,
    restarts
})

const defaultOptions = (cwd: string): SubagentOptions => ({
    cwd,
    prompt: '',
    tools: [SubagentTools.Read, SubagentTools.Grep, SubagentTools.Find, SubagentTools.Ls]
})

const configuredOptions = (ctx: ExtensionContext, tool: NopTool): SubagentOptions => {
    const nop = safeConfig(ctx)
    const thinkingLevel = read(nop, thinkingOf(tool))

    return {
        ...defaultOptions(ctx.cwd),
        thinkingLevel: thinkingLevel === inherit ? ctx.thinkingLevel : thinkingLevel,
        model: findModel(ctx.modelRegistry, read(nop, modelOf(tool))) ?? ctx.model
    }
}

const buildSession = async (options: SubagentOptions): Promise<AgentSession> => {
    const settingsManager = SettingsManager.create(options.cwd, getAgentDir())

    const loader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir: getAgentDir(),
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: options.prompt
    })
    await loader.reload()
    // A compacted page is a summary, and the model answers from it as if it were the page.
    // Overflowing must fail the run instead. Reload rereads the files, so this goes after it.
    settingsManager.applyOverrides({compaction: {enabled: false}})

    const {session} = await createAgentSession({
        cwd: options.cwd,
        sessionManager: SessionManager.inMemory(options.cwd),
        settingsManager,
        resourceLoader: loader,
        tools: options.tools,
        thinkingLevel: options.thinkingLevel,
        model: options.model
    })
    return session
}

type TurnWatch = {
    last?: AssistantMessage
    compacted: boolean
}

const watchTurn = (
    session: AgentSession,
    task: string,
    startedAt: number,
    restarts: number,
    onUpdate: SubagentUpdate
): {watch: TurnWatch; stop: () => void} => {
    const watch: TurnWatch = {compacted: false}
    let lastText = ''
    const stop = session.subscribe(event => {
        // Compaction is off in buildSession; this catches it coming back through a pi change.
        if (event.type === 'compaction_start') {
            watch.compacted = true
            void session.abort()
            return
        }

        if (event.type !== 'turn_end' || event.message.role !== 'assistant') return

        watch.last = event.message
        const text = turnText(event.message)
        if (text !== '') lastText = text

        const details = buildDetails(
            session.getSessionStats(),
            task,
            event.message,
            lastText,
            startedAt,
            restarts
        )
        onUpdate?.({type: 'turn', text: lastText, details})
    })
    return {watch, stop}
}

type Attempt = {
    watch: TurnWatch
    hit: GuardHit | undefined
    /** Drops the attempt's messages, pi's own branch pattern, so the next one starts clean. */
    rewind: () => void
}

const runAttempt = async (
    session: AgentSession,
    text: string,
    task: string,
    startedAt: number,
    restarts: number,
    onUpdate: SubagentUpdate,
    settings: GuardSettings,
    contextWindow: number
): Promise<Attempt> => {
    const leaf = session.sessionManager.getLeafId()
    const messages = [...session.agent.state.messages]
    const {watch, stop} = watchTurn(session, task, startedAt, restarts, onUpdate)
    const guards = watchGuards(session, settings, contextWindow)

    try {
        await session.prompt(text, {expandPromptTemplates: false})
    } finally {
        stop()
        guards.stop()
    }

    return {
        watch,
        hit: guards.hit(),
        rewind: () => {
            if (leaf === null) session.sessionManager.resetLeaf()
            else session.sessionManager.branch(leaf)
            session.agent.state.messages = messages
        }
    }
}

const answerText = (last: AssistantMessage): string => {
    const {stopReason, errorMessage} = last

    if (stopReason === 'error' || stopReason === 'aborted')
        throw new Error(SubagentErrors.RunFailed + (errorMessage ?? stopReason))
    if (stopReason === 'length') throw new Error(SubagentErrors.Truncated)

    const text = turnText(last)

    if (text === '') throw new Error(SubagentErrors.EmptyOutput + emptyDetail(last))
    return text
}

// What the empty turn held, so a model that answers inside its thinking can be told apart.
const emptyDetail = (last: AssistantMessage): string =>
    ` (${last.stopReason}; blocks: ${last.content.map(block => block.type).join(', ') || 'none'})`

// Every subagent run goes through prompt, so the slot cap covers all of them.
const subagentSession = (options: SubagentOptions): SubagentSession => {
    let opening: Promise<AgentSession> | undefined
    let session: AgentSession | undefined
    let disposed = false

    const dispose = (): void => {
        if (disposed) return
        disposed = true
        session?.dispose()
    }

    const open = async (): Promise<AgentSession> => {
        const built = await buildSession(options)

        if (disposed) {
            built.dispose()
            throw new Error(SubagentErrors.Disposed)
        }

        session = built
        return built
    }

    const turn = async (
        task: string,
        signal: AbortSignal | undefined,
        onUpdate: SubagentUpdate,
        settings: GuardSettings
    ): Promise<SubagentResult> => {
        const startedAt = performance.now()

        if (disposed) throw new Error(SubagentErrors.Disposed)
        if (signal?.aborted) throw new Error(SubagentErrors.Aborted)

        onUpdate?.({type: 'started'})
        opening ??= open()
        const current = await opening
        const contextWindow = current.model?.contextWindow ?? 0

        const onAbort = () => {
            void current.abort()
        }
        signal?.addEventListener('abort', onAbort, {once: true})

        try {
            let text = task

            for (let restarts = 0; ; restarts += 1) {
                if (signal?.aborted) throw new Error(SubagentErrors.Aborted)

                const {watch, hit, rewind} = await runAttempt(
                    current,
                    text,
                    task,
                    startedAt,
                    restarts,
                    onUpdate,
                    settings,
                    contextWindow
                )

                if (disposed) throw new Error(SubagentErrors.Disposed)
                if (signal?.aborted) throw new Error(SubagentErrors.Aborted)

                if (watch.compacted) {
                    dispose()
                    throw new Error(SubagentErrors.Compacted)
                }

                if (hit === undefined) {
                    if (watch.last === undefined) throw new Error(SubagentErrors.EmptyOutput)

                    const answer = answerText(watch.last)
                    return {
                        text: answer,
                        details: buildDetails(
                            current.getSessionStats(),
                            task,
                            watch.last,
                            answer,
                            startedAt,
                            restarts
                        )
                    }
                }

                if (restarts >= settings.restarts) throw new Error(SubagentErrors.Killed + hit.id)

                rewind()
                onUpdate?.({type: 'restarting', guard: hit.id})
                text = [hit.hint, task].join('\n\n')
            }
        } finally {
            signal?.removeEventListener('abort', onAbort)
        }
    }

    const prompt = (
        task: string,
        signal: AbortSignal | undefined,
        onUpdate: SubagentUpdate
    ): Promise<SubagentResult> => {
        // Read on every prompt, so a session kept open still follows the current settings.
        const nop = safeConfig()
        const cap = read(nop, concurrency)
        slots.setCap(cap === unlimited ? Number.POSITIVE_INFINITY : cap)
        return slots.run(
            () => turn(task, signal, onUpdate, guardSettings(nop)),
            () => onUpdate?.({type: 'queued'})
        )
    }

    return {prompt, dispose}
}

const runSubagent = async (
    task: string,
    signal: AbortSignal | undefined,
    onUpdate: SubagentUpdate,
    options: SubagentOptions
): Promise<SubagentResult> => {
    const handle = subagentSession(options)

    try {
        return await handle.prompt(task, signal, onUpdate)
    } finally {
        handle.dispose()
    }
}

// How a tool turns its params into the subagent task. It gets the configured options and may
// narrow them (prompt, tools). Everything else (run, progress, TUI) is shared and not optional.
type SubagentPrepare<T extends TObject> = (
    params: Static<T>,
    signal: AbortSignal | undefined,
    options: SubagentOptions
) => Promise<{
    task: string
    options: SubagentOptions
    /** When set, the run still happens but its answer is raised as the error this builds. */
    failure?: (text: string) => string
    /** Checks the answer and returns what the caller gets; throws to reject it. */
    verify?: (text: string) => string
}>

type SubagentToolSpec<T extends TObject> = {
    name: NopTool
    label: string
    description: string
    parameters: T
    title: (args: Static<T> | undefined) => string | undefined
    prepare: SubagentPrepare<T>
}

const registerSubagentTool = <T extends TObject>(pi: ExtensionAPI, spec: SubagentToolSpec<T>) => {
    pi.registerTool<T, SubagentDetails | undefined>({
        name: spec.name,
        label: spec.label,
        description: spec.description,
        parameters: spec.parameters,
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            const {task, options, failure, verify} = await spec.prepare(
                params,
                signal,
                configuredOptions(ctx, spec.name)
            )
            const {text, details} = await runSubagent(task, signal, toolProgress(onUpdate), options)

            if (failure !== undefined) throw new Error(failure(text))
            return {
                content: [{type: 'text', text: verify === undefined ? text : verify(text)}],
                details: {...details, task: spec.title(params) ?? task}
            }
        },
        renderCall: (args, theme, ctx) => renderCall(spec.name, spec.title(args), theme, ctx),
        renderResult: (result, options, theme, ctx) =>
            renderResult(spec.name, spec.title(ctx.args), result, options, theme, ctx)
    })
}

export default function (pi: ExtensionAPI) {
    registerSubagentTool(pi, {
        name: 'subagent',
        label: 'Subagent',
        description:
            'Dispatch an isolated read-only subagent to investigate and return its CONCLUSION — '
            + 'not the raw evidence. USE THIS FIRST, instead of running your own '
            + 'ls/grep/find/read, whenever a question spans MULTIPLE files or means '
            + 'searching/scanning code you have not already located. Doing it yourself '
            + 'floods your context with raw file output; the subagent reads in isolation '
            + 'and returns only the answer. You can dispatch several in one turn for '
            + 'independent questions.\n'
            + '\n'
            + 'Good fits:\n'
            + '- "Where/how is X handled in this repo?" across unfamiliar code\n'
            + '- Audits and pattern scans across many files ("every place we log PII")\n'
            + '- Tracing a flow across layers (router → service → database)\n'
            + '- Summarising long test output, logs, or shell output you do not need verbatim\n'
            + '\n'
            + 'Skip when:\n'
            + '- You already know the exact file — call `read` directly\n'
            + '- The task needs writes/edits (subagent is read-only)',
        parameters: Type.Object({
            task: Type.String({description: 'Task for the subagent to perform.'})
        }),
        title: args => args?.task,
        prepare: (params, _signal, options) => Promise.resolve({task: params.task, options})
    })
}

export {
    configuredOptions,
    registerSubagentTool,
    runSubagent,
    SubagentErrors,
    subagentSession,
    unlessAborted
}
export type {SubagentDetails, SubagentOptions, SubagentSession, SubagentToolSpec, SubagentUpdate}
