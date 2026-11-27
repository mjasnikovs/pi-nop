import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent'
import {Type} from 'typebox'
import Value from 'typebox/value'

import {engine, engines as engineNames, read, safeConfig, searchTool} from '../config/config'
import type {EngineName} from '../config/config'
import {brave} from './brave'
import {ddg} from './ddg'
import {exa} from './exa'
import type {Engine, SearchResult} from './engines'
import {httpOnly, SearchErrors} from './engines'

const engineOverride = 'PI_NOP_SEARCH_ENGINE'
const engines: Record<EngineName, Engine> = {exa, brave, ddg}
const listed = `${engineNames.slice(0, -1).join(', ')} and ${String(engineNames.at(-1))}`

// The config was checked as it loaded, so only the environment can name an unknown engine.
const engineName = (ctx: ExtensionContext): EngineName => {
    const override = process.env[engineOverride]

    if (override === undefined) return read(safeConfig(ctx), engine)
    if (Value.Check(engine.schema, override)) return override
    throw new Error(
        `${SearchErrors.Failed}${engineOverride} is "${override}", and the engines are ${listed}`
    )
}

const formatResult = (result: SearchResult, index: number): string => {
    const lead = `${index + 1}. [${result.title}](${result.url})`
    return result.description === '' ? lead : `${lead} — ${result.description}`
}

const formatResults = (query: string, results: SearchResult[]): string =>
    results.length === 0 ? `No results for: ${query}` : results.map(formatResult).join('\n')

export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: searchTool,
        label: 'Web Search',
        description:
            'Search the live web. CALL THIS BEFORE ANSWERING any question about current or '
            + 'version-specific external facts: library/framework versions and their APIs, '
            + 'latest releases, recently shipped features, current events, prices, or who '
            + 'currently holds a role. Your built-in knowledge is out of date — do NOT answer '
            + 'such questions from memory and do NOT shell out with bash to guess. Returns a '
            + 'numbered list of up to 10 results (title, URL, snippet); then call '
            + '`subagent-fetch` on the URL you want to read. A snippet is a teaser, not the '
            + 'page: when the detail matters, fetch the page.',
        parameters: Type.Object({
            query: Type.String({
                description:
                    'What to search for. Keywords or a short question; name the product '
                    + 'and version when known.'
            })
        }),
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            const name = engineName(ctx)
            const results = httpOnly(await engines[name](params.query, signal))
            return {
                content: [{type: 'text', text: formatResults(params.query, results)}],
                details: {engine: name, results: results.length}
            }
        }
    })
}

export {engineOverride, formatResults}
