import {afterAll, beforeEach, describe, expect, mock, test} from 'bun:test'
import {readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {ModelRegistry} from '@earendil-works/pi-coding-agent'
import type {Api, Model} from '@earendil-works/pi-ai'

import {agentDir, getAgentDir, useAgentDir} from '../agentDir'

const actual = await import('@earendil-works/pi-coding-agent')
await mock.module('@earendil-works/pi-coding-agent', () => ({...actual, getAgentDir}))

const {findModel, loadConfig, modelSpec, saveConfig, thinkingLevels} =
    await import('../../src/config/config')

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
