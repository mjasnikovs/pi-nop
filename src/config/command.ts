import type {ExtensionAPI, ExtensionCommandContext} from '@earendil-works/pi-coding-agent'
import {getSelectListTheme, getSettingsListTheme} from '@earendil-works/pi-coding-agent'
import type {SettingItem} from '@earendil-works/pi-tui'
import {SelectList, SettingsList} from '@earendil-works/pi-tui'
import {readFileSync} from 'node:fs'

import {describe} from '../subagent/describe'
import {boxed} from './box'
import {
    applyChange,
    inherit,
    modelOf,
    modelSpec,
    read,
    loadSafely,
    setAsideBroken,
    saveConfig,
    settings,
    tools
} from './config'
import type {NopConfig, Setting} from './config'
import {gap, header, settable, skipInert} from './sections'

const maxVisible = 10
const packageJson = new URL('../../package.json', import.meta.url)
const title = (): string =>
    `pi-nop v${(JSON.parse(readFileSync(packageJson, 'utf8')) as {version: string}).version}`

const modelPicker =
    (options: string[]) =>
    (current: string, done: (selected?: string) => void): SelectList => {
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

const offered = (setting: Setting): string[] => {
    const levels = (setting.levels ?? []).map(String)
    const fallback = String(setting.fallback)
    return levels.includes(fallback) ? levels : [fallback, ...levels]
}

const row = (config: NopConfig, models: string[], setting: Setting): SettingItem => ({
    id: setting.id,
    label: setting.label,
    description: setting.description,
    currentValue: String(read(config, setting)),
    ...(setting.levels === undefined ?
        {submenu: modelPicker([String(setting.fallback), ...models])}
    :   {values: offered(setting)})
})

const sections = [...new Set(settings.map(setting => setting.section))]
const same = (text: string): string => text

const panelItems = (config: NopConfig, models: string[], paint = same): SettingItem[] =>
    sections.flatMap((section, index) => [
        ...(index === 0 ? [] : [gap(section)]),
        header(section, paint),
        ...settings
            .filter(setting => setting.section === section)
            .map(setting => row(config, models, setting))
    ])

// An empty registry says nothing about the saved models, so they are left alone.
const dropStaleModels = (config: NopConfig, models: string[]): NopConfig =>
    tools.reduce((fixed, tool) => {
        if (models.length === 0) return fixed
        const model = read(fixed, modelOf(tool))
        return model === inherit || models.includes(model) ?
                fixed
            :   applyChange(fixed, modelOf(tool).id, inherit)
    }, config)

// The file may have been fixed, or removed, since the panel opened; only a still broken one moves.
const keepWritten = (
    ctx: ExtensionCommandContext,
    config: NopConfig,
    available: string[]
): NopConfig => {
    const now = loadSafely()

    if (!now.broken) return dropStaleModels(now.config, available)
    ctx.ui.notify(`Saved the broken pi-nop config as ${setAsideBroken()}`, 'info')
    return config
}

const availableModels = (ctx: ExtensionCommandContext): string[] =>
    ctx.modelRegistry.getAvailable().map(modelSpec)

// The picker follows the session's model scope, as pi's own picker does. Staleness does not:
// the tools resolve a saved model against every available one, so a scoped-out model still runs.
const offeredModels = (ctx: ExtensionCommandContext, available: string[]): string[] => {
    const scoped = ctx.scopedModels.map(entry => modelSpec(entry.model))
    return scoped.length > 0 ? scoped : available
}

export default function (pi: ExtensionAPI) {
    pi.registerCommand('nop-config', {
        description:
            'Choose the model and thinking level for each subagent tool, the web search engine, '
            + 'how many subagents run at once, and the guards that stop a stuck run',
        handler: async (_args, ctx) => {
            const available = availableModels(ctx)
            const models = offeredModels(ctx, available)
            const loaded = loadSafely(ctx)
            let config = dropStaleModels(loaded.config, available)
            let broken = loaded.broken

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

            // Not awaited: a reload drops the overlay unsettled, and a waiting handler blocks pi.
            const opened = ctx.ui.custom<undefined>(
                (_tui, theme, _keybindings, done) => {
                    const items = panelItems(config, models, text => theme.fg('muted', text))
                    const list = new SettingsList(
                        items,
                        Math.min(items.length, maxVisible),
                        getSettingsListTheme(),
                        (id, value) => {
                            try {
                                if (broken) config = keepWritten(ctx, config, available)
                                broken = false
                                config = applyChange(config, id, value)
                                saveConfig(config)
                            } catch (failure) {
                                ctx.ui.notify(
                                    `pi-nop config not saved: ${describe(failure)}`,
                                    'error'
                                )
                            }
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
            opened.catch((failure: unknown) => ctx.ui.notify(String(failure), 'error'))
        }
    })
}

export {dropStaleModels, panelItems}
