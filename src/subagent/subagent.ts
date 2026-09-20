import type {ExtensionAPI, SessionStats} from '@earendil-works/pi-coding-agent'
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
    Aborted = 'Subagent aborted'
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

type SubagentDetails = SessionStats & Pick<AssistantMessage, 'model' | 'provider' | 'stopReason'>

type SubagentResult = {
    text: string
    details: SubagentDetails
}

const defaultOptions = (cwd: string): SubagentOptions => ({
    cwd,
    prompt: '',
    tools: [SubagentTools.Read, SubagentTools.Grep, SubagentTools.Find, SubagentTools.Ls],
    thinkingLevel: 'medium'
})

const runSubagent = async (
    task: string,
    signal: AbortSignal | undefined,
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

    const onAbort = () => void session.abort()
    signal?.addEventListener('abort', onAbort, {once: true})

    try {
        await session.prompt(task)

        if (signal?.aborted) throw new Error(SubagentErrors.Aborted)

        const last = session.messages.findLast(message => message.role === 'assistant')
        const text = last?.content.findLast(content => content.type === 'text')?.text

        if (last === undefined || text === undefined) throw new Error(SubagentErrors.EmptyOutput)

        const {model, provider, stopReason} = last

        return {
            text,
            details: {...session.getSessionStats(), model, provider, stopReason}
        }
    } finally {
        signal?.removeEventListener('abort', onAbort)
        session.dispose()
    }
}

export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: 'subagent',
        label: 'Subagent',
        description: 'execute subagent task',
        parameters: Type.Object({
            task: Type.String({description: 'task description'})
        }),
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            const {text, details} = await runSubagent(params.task, signal, defaultOptions(ctx.cwd))
            return {
                content: [{type: 'text', text}],
                details
            }
        }
    })
}

export {runSubagent}
