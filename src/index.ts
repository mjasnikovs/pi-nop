import type {ExtensionAPI} from '@earendil-works/pi-coding-agent'

import subagent from './subagent/subagent'

export default function (pi: ExtensionAPI) {
    pi.on('session_start', (_event, ctx) => {
        ctx.ui.notify('Extension loaded!', 'info')
    })

    subagent(pi)
}
