import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {ModelRegistry} from '@earendil-works/pi-coding-agent'
import {getAgentDir} from '@earendil-works/pi-coding-agent'
import type {ThinkingLevel} from '@earendil-works/pi-agent-core'
import type {Api, Model} from '@earendil-works/pi-ai'
import {type Static, Type} from 'typebox'
import Value from 'typebox/value'

const configFile = 'pi-nop.json'
const tools = ['subagent', 'subagent-fetch'] as const
const thinkingLevels = [
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
] as const satisfies readonly ThinkingLevel[]
const toolSchema = Type.Object(
    {
        model: Type.Optional(Type.String()),
        thinkingLevel: Type.Optional(Type.Enum(thinkingLevels))
    },
    {additionalProperties: false}
)
const configSchema = Type.Partial(Type.Record(Type.Enum(tools), toolSchema), {
    additionalProperties: false
})
const brokenConfig =
    'pi-nop config is broken, using the host model and thinking level. Run /nop-config to fix it.'

type NopTool = (typeof tools)[number]
type ToolConfig = Static<typeof toolSchema>
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

const modelSpec = (model: Model<Api>): string => `${model.provider}/${model.id}`

const findModel = (registry: ModelRegistry, spec?: string): Model<Api> | undefined =>
    registry.getAvailable().find(model => modelSpec(model) === spec)

export {brokenConfig, findModel, loadConfig, modelSpec, saveConfig, thinkingLevels, tools}
export type {NopConfig, NopTool, ToolConfig}
