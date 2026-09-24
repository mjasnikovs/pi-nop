import type {
    AssistantMessage,
    Message,
    TextContent,
    ToolCall,
    ToolResultMessage
} from '@earendil-works/pi-ai'

const extension = new URL('../src/index.ts', import.meta.url).pathname

type Run = {
    calls: ToolCall[]
    results: ToolResultMessage[]
    answer: string
    events: string
}

const text = (content: (TextContent | {type: string})[]): string =>
    content
        .filter((part): part is TextContent => part.type === 'text')
        .map(part => part.text)
        .join('')

const isAssistant = (message: Message): message is AssistantMessage => message.role === 'assistant'
const isToolResult = (message: Message): message is ToolResultMessage =>
    message.role === 'toolResult'

// Every finished message arrives as a message_end event. The rest of the stream is progress.
const runPi = async (
    prompt: string,
    tool: string,
    env: Record<string, string> = {}
): Promise<Run> => {
    const proc = Bun.spawn(
        [
            'pi',
            '-p',
            '--mode',
            'json',
            '--no-session',
            '--no-extensions',
            '--no-skills',
            '--no-context-files',
            '-e',
            extension,
            '--tools',
            tool,
            prompt
        ],
        {stdout: 'pipe', stderr: 'inherit', env: {...process.env, ...env}}
    )
    const events = await new Response(proc.stdout).text()
    await proc.exited

    const messages: Message[] = events
        .split('\n')
        .filter(line => line.startsWith('{"type":"message_end"'))
        .map(line => (JSON.parse(line) as {message: Message}).message)
    const assistant = messages.filter(isAssistant)

    return {
        calls: assistant.flatMap(m =>
            m.content.filter((part): part is ToolCall => part.type === 'toolCall')
        ),
        results: messages.filter(isToolResult),
        answer: text(assistant.at(-1)?.content ?? []),
        events
    }
}

export {runPi, text}
export type {Run}
