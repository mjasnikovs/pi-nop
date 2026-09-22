import type {ExtensionAPI} from '@earendil-works/pi-coding-agent'

import config from './config/command'
import subagent from './subagent/subagent'

export default function (pi: ExtensionAPI) {
    pi.on('session_start', (_event, ctx) => {
        ctx.ui.notify('Extension loaded!', 'info')
    })

    config(pi)
    subagent(pi)
}
