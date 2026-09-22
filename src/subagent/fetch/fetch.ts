import type {ExtensionAPI} from '@earendil-works/pi-coding-agent'
import {estimateTokens} from '@earendil-works/pi-coding-agent'
import type {Api, Model} from '@earendil-works/pi-ai'
import {Type} from 'typebox'

import {registerSubagentTool, SubagentErrors} from '../subagent'
import {digest} from './digest'

const extractionPrompt =
    'Answer the query using only the page text. Say if the page does not cover it.'

// MAGIC NUMBER: share of the context window the task may take. The rest is headroom for
// the system prompt, the answer and the rough 4 chars per token estimate pi uses.
const taskShare = 0.75

// Node wraps network errors as a bare "fetch failed" TypeError with the reason in `cause`.
const describe = (error: unknown): string => {
    if (!(error instanceof Error)) return String(error)
    if (error.cause instanceof Error) return `${error.message}: ${error.cause.message}`
    return error.message
}

const fetchPage = async (url: string, signal: AbortSignal | undefined): Promise<Response> => {
    const {protocol} = new URL(url)

    if (protocol !== 'http:' && protocol !== 'https:')
        throw new Error(SubagentErrors.FetchFailed + `unsupported protocol ${protocol}`)

    const response = await fetch(url, {signal}).catch((error: unknown) => {
        if (signal?.aborted) throw new Error(SubagentErrors.Aborted, {cause: error})
        throw new Error(SubagentErrors.FetchFailed + describe(error), {cause: error})
    })

    if (!response.ok)
        throw new Error(SubagentErrors.FetchFailed + `${response.status} ${response.statusText}`)
    return response
}

const buildTask = (query: string, url: string, page: string): string =>
    `<query>${query}</query>\n<url>${url}</url>\n<page>\n${page}\n</page>`

const assertFits = (task: string, model: Model<Api> | undefined): void => {
    if (model === undefined) throw new Error(SubagentErrors.NoModel)

    const tokens = estimateTokens({role: 'user', content: task, timestamp: Date.now()})

    if (tokens > model.contextWindow * taskShare) throw new Error(SubagentErrors.PageTooBig)
}

export default function (pi: ExtensionAPI) {
    registerSubagentTool(pi, {
        name: 'subagent-fetch',
        label: 'Subagent Fetch',
        description:
            'Fetch a web page and hand it to an isolated subagent that extracts ONLY '
            + 'content answering `query`. Returns the focused answer, never the raw page. '
            + 'REACH FOR THIS when you need to know how an external library, tool, '
            + 'framework, or service is CONFIGURED, WIRED, or INTEGRATED: fetch its README '
            + 'or official documentation page and extract the setup you need, instead of '
            + 'guessing from memory. Also use it to read any known URL without stuffing '
            + 'raw content into the main context.',
        parameters: Type.Object({
            url: Type.String({
                description:
                    'URL to fetch. Must be http or https. Use the host exactly as given. '
                    + 'Do not add or drop www.'
            }),
            query: Type.String({description: 'What to extract from the page.'})
        }),
        // Pi renders while the call is still streaming, so either field may be missing.
        title: args => [args?.query, args?.url].filter(part => part !== undefined).join(' '),
        prepare: async (params, signal, configured) => {
            const options = {...configured, prompt: extractionPrompt, tools: []}
            const response = await fetchPage(params.url, signal)
            const task = buildTask(params.query, response.url, await digest(response))
            assertFits(task, options.model)
            return {task, options}
        }
    })
}

export {buildTask, extractionPrompt, taskShare}
