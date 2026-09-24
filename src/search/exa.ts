import {Type} from 'typebox'
import Value from 'typebox/value'

import type {Engine, SearchResult} from './engines'
import {endpoint, request, resultCount, SearchErrors, squash} from './engines'

const exaEndpoint = 'https://mcp.exa.ai/mcp'

const rpcSchema = Type.Object({
    result: Type.Optional(
        Type.Object({
            content: Type.Array(
                Type.Object({type: Type.String(), text: Type.Optional(Type.String())})
            ),
            isError: Type.Optional(Type.Boolean())
        })
    ),
    error: Type.Optional(Type.Object({message: Type.String()}))
})

// The endpoint answers as an event stream. The whole reply sits in its one data frame.
const rpcText = (body: string): string => {
    const frame = body.split('\n').find(line => line.startsWith('data:'))
    const rpc = Value.Parse(rpcSchema, JSON.parse(frame === undefined ? body : frame.slice(5)))
    const text = rpc.result?.content.find(part => part.type === 'text')?.text

    if (rpc.error !== undefined) throw new Error(`${SearchErrors.Failed}exa: ${rpc.error.message}`)
    if (rpc.result?.isError === true || text === undefined)
        throw new Error(`${SearchErrors.Failed}exa: ${text ?? 'no result'}`)
    return text
}

// A block is "Title:", "URL:", some labelled lines, then "Highlights:" or "Text:" and the
// content. Highlights are several excerpts split by "..." lines; the first one is the snippet,
// so every engine hands over one snippet per result.
const parseBlock = (block: string): SearchResult | undefined => {
    const title = /^Title: (.*)$/m.exec(block)?.[1]
    const url = /^URL: (.*)$/m.exec(block)?.[1]
    const content = /^(?:Highlights|Text):[ \t]*\n?([\s\S]*)$/m.exec(block)?.[1] ?? ''
    const [snippet] = content.split(/^\.\.\.$/m)

    if (url === undefined) return undefined
    return {title: squash(title ?? '') || url, url, description: squash(snippet ?? '')}
}

const parseBlocks = (text: string): SearchResult[] =>
    text
        .split(/^---$/m)
        .map(parseBlock)
        .filter(result => result !== undefined)

const exa: Engine = async (query, signal) => {
    const reply = await request(
        'exa',
        endpoint(exaEndpoint),
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {name: 'web_search_exa', arguments: {query, numResults: resultCount}}
            })
        },
        signal
    )
    return parseBlocks(rpcText(reply.text))
}

export {exa, parseBlocks}
