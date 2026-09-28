import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import {readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {ModelRegistry} from '@earendil-works/pi-coding-agent'
import type {Api, Model} from '@earendil-works/pi-ai'

import {agentDir, getAgentDir, useAgentDir} from '../agentDir'

const actual = await import('@earendil-works/pi-coding-agent')
await mock.module('@earendil-works/pi-coding-agent', () => ({...actual, getAgentDir}))

const {
    applyChange,
    concurrency,
    engine,
    findModel,
    loadConfig,
    modelOf,
    modelSpec,
    read,
    restarts,
    saveConfig,
    settings,
    staleMinutes,
    thinkingOf,
    toolCallMinutes
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

    test('every level of every setting round-trips through the file and reads back', () => {
        for (const setting of settings) {
            for (const level of setting.levels ?? ['acme/fast']) {
                const config = applyChange({}, setting.id, String(level))
                saveConfig(config)

                expect(loadConfig()).toEqual(config)
                expect(read(loadConfig(), setting)).toBe(level)
                expect(applyChange(config, setting.id, String(setting.fallback))).toEqual({})
            }

            expect(read({}, setting)).toBe(setting.fallback)
            if (setting.levels !== undefined)
                expect(() => applyChange({}, setting.id, 'nope')).toThrow('Parse')
        }
    })

    test('rejects a row that is not a setting', () => {
        expect(() => applyChange({}, 'nope', '1')).toThrow('Unknown setting: nope')
    })

    test('declares the settings the panel and the readers share', () => {
        expect(settings.map(setting => setting.id)).toEqual([
            'subagent.model',
            'subagent.thinkingLevel',
            'subagent-fetch.model',
            'subagent-fetch.thinkingLevel',
            'subagent-docs.model',
            'subagent-docs.thinkingLevel',
            'web-search.engine',
            'concurrency',
            'staleMinutes',
            'toolCallMinutes',
            'restarts'
        ])
        expect(modelOf('subagent').fallback).toBe('inherit')
        expect(thinkingOf('subagent').levels).toEqual([
            'off',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max'
        ])
        expect([engine.levels, engine.fallback]).toEqual([['exa', 'brave', 'ddg'], 'exa'])
        expect([concurrency.levels, concurrency.fallback]).toEqual([[1, 2, 3, 4], 'unlimited'])
        expect([staleMinutes.levels, staleMinutes.fallback]).toEqual([['off', 5, 10, 20, 30], 10])
        expect([toolCallMinutes.levels, toolCallMinutes.fallback]).toEqual([
            ['off', 5, 10, 15, 30],
            15
        ])
        expect([restarts.levels, restarts.fallback]).toEqual([[0, 1, 2, 3], 2])
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
