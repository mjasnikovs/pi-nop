import type {ExtensionAPI} from '@earendil-works/pi-coding-agent'

import config from './config/command'
import webSearch from './search/search'
import docsTool from './subagent/docs/docs'
import fetchTool from './subagent/fetch/fetch'
import subagent from './subagent/subagent'

export default function (pi: ExtensionAPI) {
    pi.on('session_start', (_event, ctx) => {
        ctx.ui.notify('Extension loaded!', 'info')
    })

    config(pi)
    subagent(pi)
    fetchTool(pi)
    docsTool(pi)
    webSearch(pi)
}
