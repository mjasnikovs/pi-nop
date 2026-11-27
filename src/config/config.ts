import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {ExtensionContext, ModelRegistry} from '@earendil-works/pi-coding-agent'
import {getAgentDir} from '@earendil-works/pi-coding-agent'
import type {ThinkingLevel} from '@earendil-works/pi-agent-core'
import type {Api, Model} from '@earendil-works/pi-ai'
import {type Static, type TSchema, Type} from 'typebox'
import Value from 'typebox/value'

const configFile = 'pi-nop.json'
const tools = ['subagent', 'subagent-fetch', 'subagent-docs'] as const
const searchTool = 'web-search'
const engines = ['exa', 'brave', 'ddg'] as const
const thinkingLevels = [
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
] as const satisfies readonly ThinkingLevel[]
const inherit = 'inherit'
const unlimited = 'unlimited'
const off = 'off'
const brokenConfig = (path: string, reason: string): string =>
    `pi-nop config ${path} is broken: ${reason}. Every pi-nop setting uses its default until it is `
    + 'fixed. Run /nop-config to fix it.'
const missingModel = (spec: string): string =>
    `pi-nop model ${spec} is not available, using the host model. Run /nop-config to pick another.`

type NopTool = (typeof tools)[number]
type EngineName = (typeof engines)[number]
type Level = string | number

// The id, split on '.', is the setting's path in the file and its row id in the panel. The
// fallback is what a reader gets when the file has no value; picking it in the panel clears the key.
type Setting = {
    id: string
    section: string
    label: string
    description?: string
    levels?: readonly Level[]
    fallback: Level
    schema: TSchema
}

type Choice<L extends Level[], F extends Level> = Omit<Setting, 'levels' | 'schema'> & {
    levels: readonly [...L]
    fallback: F
}

const choice = <const L extends Level[], const F extends Level>(spec: Choice<L, F>) => ({
    ...spec,
    schema: Type.Enum(spec.levels)
})

const modelOf = (tool: NopTool) => ({
    id: `${tool}.model`,
    section: tool,
    label: 'model',
    fallback: inherit,
    schema: Type.String()
})

const thinkingOf = (tool: NopTool) =>
    choice({
        id: `${tool}.thinkingLevel`,
        section: tool,
        label: 'thinking',
        levels: thinkingLevels,
        fallback: inherit
    })

const engine = choice({
    id: `${searchTool}.engine`,
    section: searchTool,
    label: 'engine',
    levels: engines,
    fallback: 'exa'
})

const concurrency = choice({
    id: 'concurrency',
    section: 'concurrency',
    label: 'subagents at once',
    levels: [1, 2, 3, 4],
    fallback: unlimited
})

// MAGIC NUMBER: pi-task's defaults. Ten idle minutes outlasts a local model's prefill of a long
// page, fifteen covers a grep over a large tree, and a third restart stopped helping there.
const staleMinutes = choice({
    id: 'staleMinutes',
    section: 'guards',
    label: 'no model output for',
    description:
        'Kill the run when the model sends nothing for this long. Includes the time a local '
        + 'model spends reading a long prompt.',
    levels: [off, 5, 10, 20, 30],
    fallback: 10
})

const toolCallMinutes = choice({
    id: 'toolCallMinutes',
    section: 'guards',
    label: 'one tool call runs for',
    description: 'Kill the run when a single read, grep, find or ls does not return in this time.',
    levels: [off, 5, 10, 15, 30],
    fallback: 15
})

const restarts = choice({
    id: 'restarts',
    section: 'guards',
    label: 'restarts',
    description:
        'How many times a run goes again: after a kill, with a hint about what went wrong, or '
        + 'after /plan sends a goal or steps answer back. 0 keeps the guards, fails on the first '
        + 'kill and sends nothing back.',
    levels: [0, 1, 2, 3],
    fallback: 2
})

const settings: Setting[] = [
    ...tools.flatMap(tool => [modelOf(tool), thinkingOf(tool)]),
    engine,
    concurrency,
    staleMinutes,
    toolCallMinutes,
    restarts
]

const strict = {additionalProperties: false}
const path = (id: string): [string, string?] => id.split('.') as [string, string?]

const fileSchema = () => {
    const properties: Record<string, TSchema> = {}
    const nested: Record<string, Record<string, TSchema>> = {}

    for (const setting of settings) {
        const [head, tail] = path(setting.id)

        if (tail === undefined) properties[head] = Type.Optional(setting.schema)
        else {
            nested[head] ??= {}
            nested[head][tail] = Type.Optional(setting.schema)
        }
    }

    for (const [head, fields] of Object.entries(nested))
        properties[head] = Type.Optional(Type.Object(fields, strict))
    return Type.Object(properties, strict)
}

const configSchema = fileSchema()

type NopConfig = Static<typeof configSchema>

const configPath = (): string => join(getAgentDir(), configFile)

const loadConfig = (): NopConfig =>
    existsSync(configPath()) ?
        Value.Parse(configSchema, JSON.parse(readFileSync(configPath(), 'utf8')))
    :   {}

const saveConfig = (config: NopConfig): void => {
    mkdirSync(getAgentDir(), {recursive: true})
    writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n')
}

const valueAt = (value: unknown, keys: string[]): unknown =>
    keys.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], value)

// The first schema error, said as the key and the value the user wrote.
const schemaFault = (value: unknown): string => {
    const [first] = Value.Errors(configSchema, value)
    const keys = first?.instancePath.split('/').slice(1) ?? []
    const key = keys.join('.')

    if (key === '') return 'not a JSON object'
    // A strict object rejects an unknown key with a false schema.
    if (first?.keyword === 'boolean') return `${key} is not a setting`
    return `${key} is ${JSON.stringify(valueAt(value, keys))}`
}

const brokenReason = (): string => {
    let parsed: unknown

    try {
        parsed = JSON.parse(readFileSync(configPath(), 'utf8'))
    } catch {
        return 'not valid JSON'
    }

    return schemaFault(parsed)
}

type Loaded = {config: NopConfig; broken: boolean}

const loadSafely = (ctx?: ExtensionContext): Loaded => {
    try {
        return {config: loadConfig(), broken: false}
    } catch {
        ctx?.ui.notify(brokenConfig(configPath(), brokenReason()), 'warning')
        return {config: {}, broken: true}
    }
}

const safeConfig = (ctx?: ExtensionContext): NopConfig => loadSafely(ctx).config

// The first save over a broken file would lose what the user wrote, so it moves aside first.
const setAsideBroken = (): string => {
    const aside = `${configPath()}.broken`
    renameSync(configPath(), aside)
    return aside
}

const stored = (config: NopConfig, id: string): unknown =>
    id.split('.').reduce<unknown>((node, key) => (node as NopConfig | undefined)?.[key], config)

const read = <S extends Setting>(
    config: NopConfig,
    setting: S
): Static<S['schema']> | S['fallback'] =>
    (stored(config, setting.id) as Static<S['schema']> | undefined) ?? setting.fallback

const put = (config: NopConfig, id: string, value: unknown): NopConfig => {
    const [head, tail] = path(id)
    const {[head]: current, ...rest} = config
    if (tail === undefined) return value === undefined ? rest : {...rest, [head]: value}

    const {[tail]: _dropped, ...entry} = (current ?? {}) as NopConfig
    const next = value === undefined ? entry : {...entry, [tail]: value}
    return Object.keys(next).length === 0 ? rest : {...rest, [head]: next}
}

const applyChange = (config: NopConfig, id: string, value: string): NopConfig => {
    const setting = settings.find(entry => entry.id === id)
    if (setting === undefined) throw new Error(`Unknown setting: ${id}`)
    if (value === String(setting.fallback)) return put(config, id, undefined)

    const level = setting.levels?.find(entry => String(entry) === value) ?? value
    return put(config, id, Value.Parse(setting.schema, level))
}

const modelSpec = (model: Model<Api>): string => `${model.provider}/${model.id}`

const findModel = (registry: ModelRegistry, spec?: string): Model<Api> | undefined =>
    registry.getAvailable().find(model => modelSpec(model) === spec)

export {
    applyChange,
    brokenConfig,
    concurrency,
    engine,
    engines,
    findModel,
    inherit,
    loadConfig,
    loadSafely,
    missingModel,
    modelOf,
    modelSpec,
    off,
    read,
    restarts,
    safeConfig,
    setAsideBroken,
    saveConfig,
    searchTool,
    settings,
    staleMinutes,
    thinkingOf,
    toolCallMinutes,
    tools,
    unlimited
}
export type {EngineName, NopConfig, NopTool, Setting}
