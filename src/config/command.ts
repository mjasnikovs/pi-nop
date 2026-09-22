import type {ExtensionAPI} from '@earendil-works/pi-coding-agent'
import type {ThinkingLevel} from '@earendil-works/pi-agent-core'

import {modelSpec, saveConfig, thinkingLevels} from './config'

const inherit = 'inherit'

export default function (pi: ExtensionAPI) {
    pi.registerCommand('nop-config', {
        description: 'Choose the subagent model and thinking level',
        handler: async (_args, ctx) => {
            const models = ctx.modelRegistry.getAvailable().map(modelSpec)
            const model = await ctx.ui.select('Subagent model', [inherit, ...models])

            if (model === undefined) return

            const thinkingLevel = await ctx.ui.select('Subagent thinking', [
                inherit,
                ...thinkingLevels
            ])

            if (thinkingLevel === undefined) return

            saveConfig({
                model: model === inherit ? undefined : model,
                thinkingLevel:
                    thinkingLevel === inherit ? undefined : (thinkingLevel as ThinkingLevel)
            })
            ctx.ui.notify(`Subagent: ${model} / ${thinkingLevel}`, 'info')
        }
    })
}
