import type {ExtensionAPI} from '@earendil-works/pi-coding-agent'

import config from './config/command'
import webSearch from './search/search'
import docsTool from './subagent/docs/docs'
import fetchTool from './subagent/fetch/fetch'
import plan from './plan/plan'
import subagent from './subagent/subagent'

export default function (pi: ExtensionAPI) {
    config(pi)
    subagent(pi)
    fetchTool(pi)
    docsTool(pi)
    webSearch(pi)
    plan(pi)
}
