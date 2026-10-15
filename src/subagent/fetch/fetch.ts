import type {ExtensionAPI} from '@earendil-works/pi-coding-agent'
import type {Api, Model} from '@earendil-works/pi-ai'
import {Type} from 'typebox'

import {layoutPrompt, parseAnswer, verifyAnswer} from '../answer'
import {fits} from '../budget'
import {describe} from '../describe'
import {registerSubagentTool, SubagentErrors, unlessAborted} from '../subagent'
import {digest} from './digest'
import type {Digest} from './digest'
import {FetchErrors} from './errors'

type Target = {
    url: string
    headers: Record<string, string>
}

// fetch rejects a URL that carries credentials, so they move into the auth header.
const parseTarget = (url: string): Target => {
    const parsed = new URL(url)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        throw new Error(FetchErrors.Failed + `unsupported protocol ${parsed.protocol}`)
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
        unlessAborted(signal, error)
        throw new Error(FetchErrors.Failed + describe(error), {cause: error})
    })

const status = (response: Response, requested: string): string => {
    const where = response.url === '' || response.url === requested ? '' : ` at ${response.url}`
    const retryAfter = response.headers.get('retry-after')
    const wait = retryAfter === null ? '' : `, Retry-After: ${retryAfter}`
    return `${response.status} ${response.statusText}${where}${wait}`
}

type Page = Pick<Digest, 'text' | 'sources'> & {
    url: string
    /** Set when the server answered with an error status. */
    failure?: string
}

// MAGIC NUMBER: the Fetch Standard fails a request at its twentieth redirect. A refresh
// chain is followed like redirects, so it gets the same cap.
const maxRefreshes = 20
const origin = (url: string): string => new URL(url).origin

// Like fetch on a redirect: credentials stay within their origin. A refresh that cannot
// be fetched is ignored, as a browser would, and the current page stands.
const refreshTarget = (page: Digest, from: Target, base: string): Target | undefined => {
    if (page.refresh === undefined) return undefined

    try {
        const next = parseTarget(new URL(page.refresh, base).href)
        if (origin(next.url) !== origin(from.url)) return next
        return {...next, headers: {...from.headers, ...next.headers}}
    } catch {
        return undefined
    }
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
        const page: Digest = await digest(response, signal).catch((error: unknown) => {
            unlessAborted(signal, error)
            if (failure === undefined) throw error
            return {text: ''}
        })

        if (failure !== undefined) return {url, text: page.text, failure}

        const next = seen.size > maxRefreshes ? undefined : refreshTarget(page, target, url)

        if (next === undefined || seen.has(next.url))
            return {url, text: page.text, sources: page.sources}
        target = next
    }
}

const pagePrompt = layoutPrompt({
    source: 'page text',
    subject: 'page',
    unit: 'page line',
    answerNotes: ['If the page states when it was written or updated, include that.']
})

const buildTask = (query: string, url: string, page: string, failure?: string): string =>
    [
        `<query>${query}</query>`,
        `<url>${url}</url>`,
        ...(failure === undefined ? [] : [`<status>${failure}</status>`]),
        `<page>\n${page}\n</page>`
    ].join('\n')

// The status leads and the layout goes, or the caller reads "COVERED: yes" as a success.
// Text not in the layout is dropped, as verifyAnswer would reject it.
const describeFailure = (failure: string, text: string): string => {
    const lead = FetchErrors.Failed + `${failure}. Report this status.`
    const answer = parseAnswer(text)?.answer

    if (answer === undefined) return lead
    return `${lead} The error page adds:\n${answer}`
}

// An oversized error page still reports its status; the size is the lesser fact.
const assertFits = (task: string, model: Model<Api> | undefined, failure?: string): void => {
    if (model === undefined) throw new Error(SubagentErrors.NoModel)
    if (fits(task, model)) return
    if (failure === undefined) throw new Error(FetchErrors.PageTooBig)
    throw new Error(FetchErrors.Failed + failure)
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
            + 'A failed fetch is final: do not retry the same URL, and do not guess what '
            + 'the page or server would have said.',
        parameters: Type.Object({
            url: Type.String({
                description:
                    'URL to fetch. Must be http or https. Use the host exactly as given. '
                    + 'Do not add or drop www. A user:password@ prefix is fine: it is sent '
                    + 'as basic auth and never shown.'
            }),
            query: Type.String({description: 'What to extract from the page.'})
        }),
        // Pi renders while the call is still streaming, so either field may be missing.
        title: args => [args?.query, args?.url].filter(part => part !== undefined).join(' '),
        prepare: async (params, signal, configured) => {
            const options = {...configured, prompt: pagePrompt, tools: []}
            const page = await loadPage(params.url, signal)
            const failure = page.failure

            if (failure !== undefined && page.text === '')
                throw new Error(FetchErrors.Failed + failure)

            const task = buildTask(params.query, page.url, page.text, failure)
            assertFits(task, options.model, failure)
            const sources = [{text: page.text, wholeLines: false}, ...(page.sources ?? [])]
            const verify = (text: string) => verifyAnswer(text, sources)

            if (failure === undefined) return {task, options, verify}
            return {task, options, verify, failure: text => describeFailure(failure, text)}
        }
    })
}

export {buildTask, pagePrompt, parseTarget, status}
