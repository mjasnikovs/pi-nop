import type {AgentSession, ExtensionAPI, SessionStats} from '@earendil-works/pi-coding-agent'
import {
    createAgentSession,
    DefaultResourceLoader,
    getAgentDir,
    SessionManager,
    SettingsManager
} from '@earendil-works/pi-coding-agent'
import type {ThinkingLevel} from '@earendil-works/pi-agent-core'
import type {Api, AssistantMessage, Model} from '@earendil-works/pi-ai'
import {Type} from 'typebox'

enum SubagentErrors {
    EmptyOutput = 'Empty model output',
    Aborted = 'Subagent aborted',
    RunFailed = 'Subagent run failed: '
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
    thinkingLevel: ThinkingLevel
    model?: Model<Api>
}

type SubagentDetails = SessionStats
    & Pick<AssistantMessage, 'model' | 'provider' | 'stopReason' | 'timestamp'> & {
        task: string
        lastAssistantText: string
    }

type SubagentResult = {
    text: string
    details: SubagentDetails
}

type SubagentProgress = (details: SubagentDetails) => void

const lastAssistant = (session: AgentSession): AssistantMessage | undefined =>
    session.messages.findLast(message => message.role === 'assistant')

const buildDetails = (
    session: AgentSession,
    task: string,
    last: AssistantMessage
): SubagentDetails => ({
    ...session.getSessionStats(),
    model: last.model,
    provider: last.provider,
    stopReason: last.stopReason,
    timestamp: last.timestamp,
    task,
    lastAssistantText: session.getLastAssistantText() ?? ''
})

const defaultOptions = (cwd: string): SubagentOptions => ({
    cwd,
    prompt: '',
    tools: [SubagentTools.Read, SubagentTools.Grep, SubagentTools.Find, SubagentTools.Ls],
    thinkingLevel: 'medium'
})

const runSubagent = async (
    task: string,
    signal: AbortSignal | undefined,
    onProgress: SubagentProgress,
    options: SubagentOptions = defaultOptions(process.cwd())
): Promise<SubagentResult> => {
    if (signal?.aborted) throw new Error(SubagentErrors.Aborted)

    const loader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir: getAgentDir(),
        settingsManager: SettingsManager.create(options.cwd, getAgentDir()),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: options.prompt
    })
    await loader.reload()

    const {session} = await createAgentSession({
        cwd: options.cwd,
        sessionManager: SessionManager.inMemory(options.cwd),
        resourceLoader: loader,
        tools: options.tools,
        thinkingLevel: options.thinkingLevel,
        model: options.model
    })

    const onAbort = () => {
        void session.abort()
    }
    signal?.addEventListener('abort', onAbort, {once: true})

    const unsubscribe = session.subscribe(event => {
        if (event.type !== 'message_end') return
        const last = lastAssistant(session)
        if (last !== undefined) onProgress(buildDetails(session, task, last))
    })

    try {
        if (signal?.aborted) throw new Error(SubagentErrors.Aborted)

        await session.prompt(task, {expandPromptTemplates: false})

        if (signal?.aborted) throw new Error(SubagentErrors.Aborted)

        const last = lastAssistant(session)

        if (last === undefined) throw new Error(SubagentErrors.EmptyOutput)

        const {stopReason, errorMessage} = last

        if (stopReason === 'error' || stopReason === 'aborted')
            throw new Error(SubagentErrors.RunFailed + (errorMessage ?? stopReason))

        const text = session.getLastAssistantText()

        if (text === undefined) throw new Error(SubagentErrors.EmptyOutput)

        return {text, details: buildDetails(session, task, last)}
    } finally {
        signal?.removeEventListener('abort', onAbort)
        unsubscribe()
        session.dispose()
    }
}

export default function (pi: ExtensionAPI) {
    pi.registerTool({
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
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            const {text, details} = await runSubagent(
                params.task,
                signal,
                progress =>
                    onUpdate?.({
                        content: [{type: 'text', text: progress.lastAssistantText}],
                        details: progress
                    }),
                defaultOptions(ctx.cwd)
            )

            return {
                content: [{type: 'text', text}],
                details
            }
        }
    })
}

export {runSubagent}
export type {SubagentDetails, SubagentProgress}
