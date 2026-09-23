import type {ExtensionAPI} from '@earendil-works/pi-coding-agent'
import {estimateTokens} from '@earendil-works/pi-coding-agent'
import type {Api, Model} from '@earendil-works/pi-ai'
import {Type} from 'typebox'

import {registerSubagentTool, SubagentErrors} from '../subagent'
import {digest} from './digest'
import type {Digest} from './digest'

const extractionPrompt =
    'Answer the query using only the page text. Say if the page does not cover it. '
    + 'If the page states when it was written or updated, include that.'

// MAGIC NUMBER: share of the context window the task may take. The rest is headroom for
// the system prompt, the answer and the rough 4 chars per token estimate pi uses.
const taskShare = 0.75

// Node wraps network errors as a bare "fetch failed" TypeError with the reason in `cause`.
const describe = (error: unknown): string => {
    if (!(error instanceof Error)) return String(error)
    if (error.cause instanceof Error) return `${error.message}: ${error.cause.message}`
    return error.message
}

type Target = {
    url: string
    headers: Record<string, string>
}

// fetch rejects a URL that carries credentials, so they move into the auth header.
const parseTarget = (url: string): Target => {
    const parsed = new URL(url)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        throw new Error(SubagentErrors.FetchFailed + `unsupported protocol ${parsed.protocol}`)
    if (parsed.username === '' && parsed.password === '') return {url: parsed.href, headers: {}}

    const user = decodeURIComponent(parsed.username)
    const pass = decodeURIComponent(parsed.password)
    const token = Buffer.from(`${user}:${pass}`).toString('base64')
    parsed.username = ''
    parsed.password = ''
    return {url: parsed.href, headers: {authorization: `Basic ${token}`}}
}

const fetchPage = async (target: Target, signal: AbortSignal | undefined): Promise<Response> =>
    fetch(target.url, {signal, headers: target.headers}).catch((error: unknown) => {
        if (signal?.aborted) throw new Error(SubagentErrors.Aborted, {cause: error})
        throw new Error(SubagentErrors.FetchFailed + describe(error), {cause: error})
    })

const status = (response: Response, requested: string): string => {
    const where = response.url === '' || response.url === requested ? '' : ` at ${response.url}`
    const retryAfter = response.headers.get('retry-after')
    const wait = retryAfter === null ? '' : `, Retry-After: ${retryAfter}`
    return `${response.status} ${response.statusText}${where}${wait}`
}

type Page = {
    url: string
    text: string
    /** Set when the server answered with an error status. */
    failure?: string
}

// Meta refreshes are followed like redirects; a target seen before ends the chain.
const loadPage = async (requested: string, signal: AbortSignal | undefined): Promise<Page> => {
    const seen = new Set<string>()
    let target = parseTarget(requested)

    for (;;) {
        seen.add(target.url)
        const response = await fetchPage(target, signal)
        const url = response.url === '' ? target.url : response.url
        const failure = response.ok ? undefined : status(response, target.url)
        const page: Digest = await digest(response).catch((error: unknown) => {
            if (failure === undefined) throw error
            return {text: ''}
        })

        if (failure !== undefined) return {url, text: page.text, failure}

        const next = page.refresh === undefined ? undefined : new URL(page.refresh, url).href

        if (next === undefined || seen.has(next)) return {url, text: page.text}
        target = {...target, url: next}
    }
}

const buildTask = (query: string, url: string, page: string, failure?: string): string =>
    [
        `<query>${query}</query>`,
        `<url>${url}</url>`,
        ...(failure === undefined ? [] : [`<status>${failure}</status>`]),
        `<page>\n${page}\n</page>`
    ].join('\n')

// pi counts 4 chars per token, which holds for ASCII only. Other scripts run near one
// token per character, and the plain estimate let CJK pages through that then overflowed.
const estimateTaskTokens = (task: string): number => {
    const nonAscii = task.match(/[\u0080-\uffff]/g)?.length ?? 0
    const base = estimateTokens({role: 'user', content: task, timestamp: Date.now()})
    return base + nonAscii - Math.floor(nonAscii / 4)
}

const assertFits = (task: string, model: Model<Api> | undefined): void => {
    if (model === undefined) throw new Error(SubagentErrors.NoModel)
    if (estimateTaskTokens(task) > model.contextWindow * taskShare)
        throw new Error(SubagentErrors.PageTooBig)
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
            + 'raw content into the main context. If the result says the page does not '
            + 'cover the query, report that as the answer; do not fill the gap from memory. '
            + 'A failed fetch is final: do not retry the same URL.',
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
            const page = await loadPage(params.url, signal)

            if (page.failure !== undefined && page.text === '')
                throw new Error(SubagentErrors.FetchFailed + page.failure)

            const task = buildTask(params.query, page.url, page.text, page.failure)
            assertFits(task, options.model)
            return {task, options, failure: page.failure}
        }
    })
}

export {buildTask, extractionPrompt, taskShare}
