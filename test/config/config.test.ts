import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import {readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {ModelRegistry} from '@earendil-works/pi-coding-agent'
import type {Api, Model} from '@earendil-works/pi-ai'

import {agentDir, getAgentDir, useAgentDir} from '../agentDir'

const actual = await import('@earendil-works/pi-coding-agent')
await mock.module('@earendil-works/pi-coding-agent', () => ({...actual, getAgentDir}))

const {
    concurrencyKey,
    concurrencyLevels,
    guardDefaults,
    off,
    restartLevels,
    staleMinutes,
    toolCallMinutes,
    defaultEngine,
    engines,
    findModel,
    loadConfig,
    modelSpec,
    saveConfig,
    searchTool,
    thinkingLevels
} = await import('../../src/config/config')

const configPath = join(agentDir, 'pi-nop.json')
useAgentDir()

beforeEach(() => {
    rmSync(configPath, {force: true})
})

afterAll(() => {
    mock.restore()
})

describe('config', () => {
    test('returns the default when the file is missing', () => {
        expect(loadConfig()).toEqual({})
        expect(loadConfig()).toEqual({})
    })

    test('throws when the file is not JSON', () => {
        writeFileSync(configPath, 'nope')

        expect(loadConfig).toThrow(SyntaxError)
    })

    test('throws when the file does not match the schema', () => {
        for (const raw of [
            'null',
            '"acme/fast"',
            '{"model":"acme/fast","thinkingLevel":"high"}',
            '{"other":{"model":"acme/fast"}}',
            '{"subagent":{"model":1,"thinkingLevel":"high"}}',
            '{"subagent":{"thinkingLevel":"ultra"}}',
            '{"subagent":{"tools":[]}}',
            '{"subagent":{"engine":"exa"}}',
            '{"web-search":{"engine":"bing"}}',
            '{"web-search":{"model":"acme/fast"}}',
            '{"concurrency":0}',
            '{"concurrency":5}',
            '{"concurrency":"2"}',
            '{"concurrency":2.5}',
            '{"concurrency":null}',
            '{"staleMinutes":0}',
            '{"staleMinutes":"5"}',
            '{"staleMinutes":"on"}',
            '{"toolCallMinutes":20}',
            '{"toolCallMinutes":null}',
            '{"restarts":4}',
            '{"restarts":"off"}',
            '{"restarts":1.5}',
            '[]',
            '{"subagent":null}',
            '{"subagent":[]}'
        ]) {
            writeFileSync(configPath, raw)

            expect(loadConfig).toThrow('Parse')
        }
    })

    test('accepts an empty object and an empty tool', () => {
        writeFileSync(configPath, '{}')
        expect(loadConfig()).toEqual({})

        writeFileSync(configPath, '{"subagent":{}}')
        expect(loadConfig()).toEqual({subagent: {}})
    })

    test('saves an empty config as an empty object', () => {
        saveConfig({})

        expect(readFileSync(configPath, 'utf8')).toBe('{}\n')
    })

    test('accepts a partial file', () => {
        writeFileSync(configPath, '{"subagent-fetch":{"model":"acme/fast"}}')

        expect(loadConfig()).toEqual({'subagent-fetch': {model: 'acme/fast'}})
    })

    test('accepts a search engine', () => {
        writeFileSync(configPath, '{"web-search":{"engine":"ddg"}}')

        expect(loadConfig()).toEqual({'web-search': {engine: 'ddg'}})
    })

    test('accepts every concurrency level', () => {
        for (const level of concurrencyLevels) {
            writeFileSync(configPath, `{"concurrency":${level}}`)

            expect(loadConfig()).toEqual({concurrency: level})
        }
    })

    test('accepts every guard level and off for the timers', () => {
        for (const value of ['"off"', ...staleMinutes.map(String)]) {
            writeFileSync(configPath, `{"staleMinutes":${value}}`)
            expect(loadConfig()).toEqual({staleMinutes: JSON.parse(value)})
        }

        for (const value of ['"off"', ...toolCallMinutes.map(String)]) {
            writeFileSync(configPath, `{"toolCallMinutes":${value}}`)
            expect(loadConfig()).toEqual({toolCallMinutes: JSON.parse(value)})
        }

        for (const value of restartLevels) {
            writeFileSync(configPath, `{"restarts":${value}}`)
            expect(loadConfig()).toEqual({restarts: value})
        }
    })

    test('pins the guard levels and their defaults', () => {
        expect(staleMinutes).toEqual([5, 10, 20, 30])
        expect(toolCallMinutes).toEqual([5, 10, 15, 30])
        expect(restartLevels).toEqual([0, 1, 2, 3])
        expect(guardDefaults).toEqual({staleMinutes: 10, toolCallMinutes: 15, restarts: 2})
        expect(off).toBe('off')
    })

    test('lists every concurrency level under the concurrency key', () => {
        expect(concurrencyLevels).toEqual([1, 2, 3, 4])
        expect(concurrencyKey).toBe('concurrency')
    })

    test('lists every engine and defaults to exa', () => {
        expect(engines).toEqual(['exa', 'brave', 'ddg'])
        expect(defaultEngine).toBe('exa')
        expect(searchTool).toBe('web-search')
    })

    test('creates the agent dir when saving', () => {
        rmSync(agentDir, {recursive: true, force: true})

        saveConfig({subagent: {thinkingLevel: 'low'}})

        expect(loadConfig()).toEqual({subagent: {thinkingLevel: 'low'}})
    })

    test('saves pretty JSON and loads it back', () => {
        saveConfig({subagent: {model: 'acme/fast', thinkingLevel: 'high'}})

        expect(readFileSync(configPath, 'utf8')).toBe(
            '{\n  "subagent": {\n    "model": "acme/fast",\n    "thinkingLevel": "high"\n  }\n}\n'
        )
        expect(loadConfig()).toEqual({subagent: {model: 'acme/fast', thinkingLevel: 'high'}})
    })

    test('lists every thinking level', () => {
        expect(thinkingLevels).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    })

    test('formats a model as provider/id', () => {
        expect(modelSpec({provider: 'acme', id: 'fast'} as Model<Api>)).toBe('acme/fast')
    })

    test('finds an available model by provider/id', () => {
        const model = {provider: 'acme', id: 'org/fast'} as Model<Api>
        const registry = {getAvailable: () => [model]} as unknown as ModelRegistry
        expect(findModel(registry, 'acme/org/fast')).toBe(model)
        expect(findModel(registry, 'acme/slow')).toBeUndefined()
        expect(findModel(registry, undefined)).toBeUndefined()
    })
})
