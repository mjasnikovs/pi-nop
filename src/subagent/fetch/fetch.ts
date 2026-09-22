import type {ExtensionAPI} from '@earendil-works/pi-coding-agent'
import {Type} from 'typebox'

import {configuredOptions, runSubagent, SubagentErrors} from '../subagent'

const extractionPrompt =
    'Answer the query using only the page text. Say if the page does not cover it.'

const fetchPage = async (url: string, signal: AbortSignal | undefined): Promise<string> => {
    const response = await fetch(url, {signal})

    if (!response.ok)
        throw new Error(SubagentErrors.FetchFailed + `${response.status} ${response.statusText}`)
    return response.text()
}

const buildTask = (query: string, url: string, page: string): string =>
    `<query>${query}</query>\n<url>${url}</url>\n<page>\n${page}\n</page>`

export default function (pi: ExtensionAPI) {
    pi.registerTool({
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
            url: Type.String({description: 'URL to fetch. Must be http or https.'}),
            query: Type.String({description: 'What to extract from the page.'})
        }),
        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            const page = await fetchPage(params.url, signal)
            const {text, details} = await runSubagent(
                buildTask(params.query, params.url, page),
                signal,
                onUpdate,
                {...configuredOptions(ctx), prompt: extractionPrompt, tools: []}
            )

            return {
                content: [{type: 'text', text}],
                details
            }
        }
    })
}

export {buildTask, extractionPrompt}
