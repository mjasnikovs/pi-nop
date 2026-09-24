import type {ExtensionAPI, ExtensionCommandContext} from '@earendil-works/pi-coding-agent'
import {getSelectListTheme, getSettingsListTheme} from '@earendil-works/pi-coding-agent'
import type {SettingItem} from '@earendil-works/pi-tui'
import {SelectList, SettingsList} from '@earendil-works/pi-tui'
import type {ThinkingLevel} from '@earendil-works/pi-agent-core'
import {readFileSync} from 'node:fs'
import Value from 'typebox/value'

import {boxed} from './box'
import {
    brokenConfig,
    defaultEngine,
    engines,
    loadConfig,
    modelSpec,
    saveConfig,
    searchSchema,
    searchTool,
    thinkingLevels,
    tools
} from './config'
import {gap, header, settable, skipInert} from './sections'
import type {NopConfig, NopTool, ToolConfig} from './config'

const inherit = 'inherit'
const maxVisible = 10
// Two levels up from both src/config and dist/config, so the built package reads the same file.
const packageJson = new URL('../../package.json', import.meta.url)
const title = (): string =>
    `pi-nop v${(JSON.parse(readFileSync(packageJson, 'utf8')) as {version: string}).version}`

type Field = keyof ToolConfig

const rowId = (tool: NopTool, field: Field): string => `${tool}.${field}`
const engineRow = `${searchTool}.engine`

const parseRowId = (id: string): [NopTool, Field] => {
    const [tool, field] = id.split('.') as [NopTool, Field]
    return [tool, field]
}

const modelPicker =
    (models: string[]) =>
    (current: string, done: (selected?: string) => void): SelectList => {
        const options = [inherit, ...models]
        const list = new SelectList(
            options.map(value => ({value, label: value})),
            Math.min(options.length, maxVisible),
            getSelectListTheme()
        )
        list.setSelectedIndex(options.indexOf(current))
        list.onSelect = item => done(item.value)
        list.onCancel = () => done()
        return list
    }

const same = (text: string): string => text

const panelItems = (config: NopConfig, models: string[], paint = same): SettingItem[] => [
    ...tools.flatMap((tool, index) => [
        ...(index === 0 ? [] : [gap(tool)]),
        header(tool, paint),
        {
            id: rowId(tool, 'model'),
            label: 'model',
            currentValue: config[tool]?.model ?? inherit,
            submenu: modelPicker(models)
        },
        {
            id: rowId(tool, 'thinkingLevel'),
            label: 'thinking',
            currentValue: config[tool]?.thinkingLevel ?? inherit,
            values: [inherit, ...thinkingLevels]
        }
    ]),
    gap(searchTool),
    header(searchTool, paint),
    {
        id: engineRow,
        label: 'engine',
        currentValue: config[searchTool]?.engine ?? defaultEngine,
        values: [...engines]
    }
]

const withTool = (config: NopConfig, tool: NopTool, entry: ToolConfig): NopConfig => {
    const {[tool]: _dropped, ...rest} = config
    return Object.keys(entry).length === 0 ? rest : {...rest, [tool]: entry}
}

const applyChange = (config: NopConfig, id: string, value: string): NopConfig => {
    if (id === engineRow)
        return {...config, [searchTool]: Value.Parse(searchSchema, {engine: value})}

    const [tool, field] = parseRowId(id)
    const {[field]: _dropped, ...entry} = config[tool] ?? {}

    if (value === inherit) return withTool(config, tool, entry)
    // The thinking row only offers real levels, so the cast cannot let a bad one through.
    return withTool(config, tool, {...entry, [field]: value as ThinkingLevel})
}

// An empty registry says nothing about the saved models, so they are left alone.
const dropStaleModels = (config: NopConfig, models: string[]): NopConfig =>
    tools.reduce((fixed, tool) => {
        if (models.length === 0) return fixed
        const model = fixed[tool]?.model
        return model === undefined || models.includes(model) ?
                fixed
            :   applyChange(fixed, rowId(tool, 'model'), inherit)
    }, config)

const availableModels = (ctx: ExtensionCommandContext): string[] =>
    ctx.modelRegistry.getAvailable().map(modelSpec)

// The picker follows the session's model scope, as pi's own picker does. Staleness does not:
// the tools resolve a saved model against every available one, so a scoped-out model still runs.
const offeredModels = (ctx: ExtensionCommandContext, available: string[]): string[] => {
    const scoped = ctx.scopedModels.map(entry => modelSpec(entry.model))
    return scoped.length > 0 ? scoped : available
}

const openConfig = (ctx: ExtensionCommandContext): NopConfig => {
    try {
        return loadConfig()
    } catch {
        ctx.ui.notify(brokenConfig, 'warning')
        return {}
    }
}

export default function (pi: ExtensionAPI) {
    pi.registerCommand('nop-config', {
        description:
            'Choose the model and thinking level for each subagent tool, and the web search engine',
        handler: async (_args, ctx) => {
            const available = availableModels(ctx)
            const models = offeredModels(ctx, available)
            let config = dropStaleModels(openConfig(ctx), available)

            if (ctx.mode !== 'tui') {
                ctx.ui.notify(
                    panelItems(config, models)
                        .filter(settable)
                        .map(item => `${item.id}: ${item.currentValue}`)
                        .join('\n'),
                    'info'
                )
                return
            }

            await ctx.ui.custom<undefined>(
                (_tui, theme, _keybindings, done) => {
                    const items = panelItems(config, models, text => theme.fg('muted', text))
                    const list = new SettingsList(
                        items,
                        Math.min(items.length, maxVisible),
                        getSettingsListTheme(),
                        (id, value) => {
                            config = applyChange(config, id, value)
                            saveConfig(config)
                        },
                        () => done(undefined)
                    )
                    return boxed(
                        skipInert(list, items),
                        title(),
                        text => theme.fg('border', text),
                        text => theme.fg('accent', text)
                    )
                },
                {overlay: true}
            )
        }
    })
}

export {applyChange, dropStaleModels, panelItems}
