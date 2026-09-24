import {parseHTML} from 'linkedom'
import {Type} from 'typebox'
import Value from 'typebox/value'

import type {Engine} from './engines'
import {endpoint, request, resultCount, SearchErrors, squash} from './engines'

/** The fields used to read a description. Its DOM types are not in this tsconfig lib. */
type Fragment = {body: {innerHTML: string; textContent: string | null}}

const braveEndpoint = 'https://api.search.brave.com/res/v1/web/search'
const braveKey = 'BRAVE_SEARCH_API_KEY'

const bodySchema = Type.Object({
    web: Type.Optional(
        Type.Object({
            results: Type.Array(
                Type.Object({
                    title: Type.String(),
                    url: Type.String(),
                    description: Type.Optional(Type.String())
                })
            )
        })
    )
})

// Descriptions come as HTML, with the query words in <strong> and entities encoded.
const plain = (html: string): string => {
    const {document} = parseHTML('<html><body></body></html>') as {document: Fragment}
    document.body.innerHTML = html
    return squash(document.body.textContent ?? '')
}

const brave: Engine = async (query, signal) => {
    const key = process.env[braveKey]

    if (key === undefined || key === '')
        throw new Error(`${SearchErrors.Failed}${braveKey} is not set`)

    const params = new URLSearchParams({q: query, count: String(resultCount)})
    const reply = await request(
        'brave',
        `${endpoint(braveEndpoint)}?${params}`,
        {headers: {accept: 'application/json', 'x-subscription-token': key}},
        signal
    )
    const body = Value.Parse(bodySchema, JSON.parse(reply.text))
    return (body.web?.results ?? []).map(result => ({
        title: result.title,
        url: result.url,
        description: plain(result.description ?? '')
    }))
}

export {brave, braveKey}
