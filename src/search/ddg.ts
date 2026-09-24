import {parseHTML} from 'linkedom'

import type {Engine, SearchResult} from './engines'
import {endpoint, request, SearchErrors, squash} from './engines'

const ddgEndpoint = 'https://html.duckduckgo.com/html/'
// Without a browser user agent the endpoint answers a challenge page instead of results.
const browserAgent = 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0'
const challenged = 202

/** The fields read off the parsed document. Its DOM types are not in this tsconfig lib. */
type Row = {
    querySelector(selector: string): Row | null
    getAttribute(name: string): string | null
    textContent: string | null
}

type Document = {
    querySelectorAll(selector: string): Iterable<Row>
}

// Result links go through a duckduckgo.com redirect that carries the destination in uddg.
const destination = (href: string): string | undefined => {
    try {
        const link = new URL(href, ddgEndpoint)

        if (!link.hostname.endsWith('duckduckgo.com')) return link.href
        return link.searchParams.get('uddg') ?? undefined
    } catch {
        return undefined
    }
}

const parseRow = (row: Row): SearchResult | undefined => {
    const anchor = row.querySelector('a.result__a')
    const url = destination(anchor?.getAttribute('href') ?? '')

    if (anchor === null || url === undefined) return undefined
    return {
        title: squash(anchor.textContent ?? '') || url,
        url,
        description: squash(row.querySelector('.result__snippet')?.textContent ?? '')
    }
}

const parseResults = (html: string): SearchResult[] => {
    const {document} = parseHTML(html) as unknown as {document: Document}
    return [...document.querySelectorAll('.result:not(.result--ad)')]
        .map(parseRow)
        .filter(result => result !== undefined)
}

const ddg: Engine = async (query, signal) => {
    const params = new URLSearchParams({q: query})
    const reply = await request(
        'ddg',
        `${endpoint(ddgEndpoint)}?${params}`,
        {headers: {accept: 'text/html', 'user-agent': browserAgent}},
        signal
    )

    if (reply.status === challenged)
        throw new Error(`${SearchErrors.Failed}ddg answered a bot challenge instead of results`)
    return parseResults(reply.text)
}

export {browserAgent, ddg, parseResults}
