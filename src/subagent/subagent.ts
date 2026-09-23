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
import type {AgentToolUpdateCallback, ThinkingLevel} from '@earendil-works/pi-agent-core'
import type {Api, AssistantMessage, Model} from '@earendil-works/pi-ai'
import {type Static, type TObject, Type} from 'typebox'

import {brokenConfig, findModel, loadConfig} from '../config/config'
import type {NopConfig, NopTool} from '../config/config'
import {renderCall, renderResult} from './subagentTui'

enum SubagentErrors {
    EmptyOutput = 'Empty model output',
    Aborted = 'Subagent aborted',
    RunFailed = 'Subagent run failed: ',
    FetchFailed = 'Fetch failed: ',
    NoModel = 'No model selected',
    Truncated = 'Subagent output cut off at the model output limit',
    BadAnswer = 'Subagent answer failed verification: ',
    Compacted = 'Subagent context was compacted, so its answer would not rest on the page',
    PageTooBig = 'Fetch failed: page too big for the subagent model context window. Tell the user; no query and no retry can read it'
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

type SubagentDetails = SessionStats
    & Pick<AssistantMessage, 'model' | 'provider' | 'stopReason' | 'timestamp'> & {
        task: string
        lastAssistantText: string
        elapsedMs: number
    }

type SubagentResult = {
    text: string
    details: SubagentDetails
}

type SubagentUpdate = AgentToolUpdateCallback<SubagentDetails> | undefined

const progressThrottleMs = 100

const lastAssistant = (session: AgentSession): AssistantMessage | undefined =>
    session.messages.findLast(message => message.role === 'assistant')

const buildDetails = (
    stats: SessionStats,
    task: string,
    last: AssistantMessage,
    lastAssistantText: string,
    startedAt: number
): SubagentDetails => ({
    ...stats,
    model: last.model,
    provider: last.provider,
    stopReason: last.stopReason,
    timestamp: last.timestamp,
    task,
    lastAssistantText,
    elapsedMs: performance.now() - startedAt
})

const defaultOptions = (cwd: string): SubagentOptions => ({
    cwd,
    prompt: '',
    tools: [SubagentTools.Read, SubagentTools.Grep, SubagentTools.Find, SubagentTools.Ls]
})

const safeConfig = (ctx: ExtensionContext): NopConfig => {
    try {
        return loadConfig()
    } catch {
        ctx.ui.notify(brokenConfig, 'warning')
        return {}
    }
}

const configuredOptions = (ctx: ExtensionContext, tool: NopTool): SubagentOptions => {
    const config = safeConfig(ctx)[tool] ?? {}

    return {
        ...defaultOptions(ctx.cwd),
        thinkingLevel: config.thinkingLevel ?? ctx.thinkingLevel,
        model: findModel(ctx.modelRegistry, config.model) ?? ctx.model
    }
}

const runSubagent = async (
    task: string,
    signal: AbortSignal | undefined,
    onUpdate: SubagentUpdate,
    options: SubagentOptions = defaultOptions(process.cwd())
): Promise<SubagentResult> => {
    const startedAt = performance.now()

    if (signal?.aborted) throw new Error(SubagentErrors.Aborted)

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

    const onAbort = () => {
        void session.abort()
    }
    signal?.addEventListener('abort', onAbort, {once: true})

    let progressedAt = 0
    let lastText = ''
    let compacted = false

    const unsubscribe = session.subscribe(event => {
        // Compaction is off above; this catches it coming back through a pi change.
        if (event.type === 'compaction_start') {
            compacted = true
            void session.abort()
            return
        }

        if (event.type !== 'turn_end' || event.message.role !== 'assistant') return

        lastText = session.getLastAssistantText() ?? lastText

        const now = performance.now()

        if (now - progressedAt < progressThrottleMs) return

        progressedAt = now

        const details = buildDetails(
            session.getSessionStats(),
            task,
            event.message,
            lastText,
            startedAt
        )
        onUpdate?.({content: [{type: 'text', text: lastText}], details})
    })

    try {
        if (signal?.aborted) throw new Error(SubagentErrors.Aborted)

        await session.prompt(task, {expandPromptTemplates: false})

        if (signal?.aborted) throw new Error(SubagentErrors.Aborted)
        if (compacted) throw new Error(SubagentErrors.Compacted)

        const last = lastAssistant(session)

        if (last === undefined) throw new Error(SubagentErrors.EmptyOutput)

        const {stopReason, errorMessage} = last

        if (stopReason === 'error' || stopReason === 'aborted')
            throw new Error(SubagentErrors.RunFailed + (errorMessage ?? stopReason))
        if (stopReason === 'length') throw new Error(SubagentErrors.Truncated)

        const text = session.getLastAssistantText()

        if (text === undefined) throw new Error(SubagentErrors.EmptyOutput)
        return {text, details: buildDetails(session.getSessionStats(), task, last, text, startedAt)}
    } finally {
        signal?.removeEventListener('abort', onAbort)
        unsubscribe()
        session.dispose()
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
    pi.registerTool<T, SubagentDetails>({
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
            const {text, details} = await runSubagent(task, signal, onUpdate, options)

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

export {configuredOptions, progressThrottleMs, registerSubagentTool, runSubagent, SubagentErrors}
export type {SubagentDetails, SubagentOptions, SubagentToolSpec, SubagentUpdate}
