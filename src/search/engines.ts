import {describe} from '../subagent/describe'
import {parseTarget, status} from '../subagent/fetch/fetch'

enum SearchErrors {
    Failed = 'Search failed: ',
    Aborted = 'Search aborted'
}

type SearchResult = {
    title: string
    url: string
    description: string
}

type Engine = (query: string, signal: AbortSignal | undefined) => Promise<SearchResult[]>

// MAGIC NUMBER: results per search. What every engine serves by default, and one screen for the
// model that reads the list.
const resultCount = 10
const endpointOverride = 'PI_NOP_SEARCH_ENDPOINT'
// Read per call so the eval can point every engine at its fixture server.
const endpoint = (fallback: string): string => process.env[endpointOverride] ?? fallback

type Reply = {
    status: number
    text: string
}

// The body is read here too, so a cancel while it streams in is still an abort.
const request = async (
    engine: string,
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined
): Promise<Reply> => {
    const failed = (error: unknown): never => {
        if (signal?.aborted) throw new Error(SearchErrors.Aborted, {cause: error})
        throw new Error(SearchErrors.Failed + describe(error), {cause: error})
    }

    const response = await fetch(url, {...init, signal}).catch(failed)

    if (!response.ok) throw new Error(`${SearchErrors.Failed}${engine} ${status(response, url)}`)
    return {status: response.status, text: await response.text().catch(failed)}
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

// The same rule subagent-fetch applies, so every listed URL is one it will open.
const fetchable = (url: string): boolean => {
    try {
        parseTarget(url)
        return true
    } catch {
        return false
    }
}

const httpOnly = (results: SearchResult[]): SearchResult[] =>
    results.filter(result => fetchable(result.url))

export {endpoint, endpointOverride, httpOnly, request, resultCount, SearchErrors, squash}
export type {Engine, SearchResult}
