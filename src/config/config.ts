import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {ModelRegistry} from '@earendil-works/pi-coding-agent'
import {getAgentDir} from '@earendil-works/pi-coding-agent'
import type {ThinkingLevel} from '@earendil-works/pi-agent-core'
import type {Api, Model} from '@earendil-works/pi-ai'
import {type Static, Type} from 'typebox'
import Value from 'typebox/value'

const configFile = 'pi-nop.json'
const thinkingLevels = [
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
] as const satisfies readonly ThinkingLevel[]
const configSchema = Type.Object({
    model: Type.Optional(Type.String()),
    thinkingLevel: Type.Optional(Type.Enum(thinkingLevels))
})

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

export {findModel, loadConfig, modelSpec, saveConfig, thinkingLevels}
export type {NopConfig}
