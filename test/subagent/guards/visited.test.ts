import {describe, expect, test} from 'bun:test'

import {createVisited, readCall, readEnd} from '../../../src/subagent/guards/visited'
import {end, start} from './fake'

const truncated = (outputLines: number) => ({truncation: {outputLines}})
describe('readCall', () => {
    test("parses a read into a line span, up to pi's cap when limit is missing", () => {
        expect(readCall('read', {path: 'a.ts'})).toEqual({path: 'a.ts', from: 1, to: 2000})
        expect(readCall('read', {path: 'a.ts', offset: 10, limit: 5})).toEqual({
            path: 'a.ts',
            from: 10,
            to: 14
        })
        expect(readCall('read', {path: 'a.ts', offset: 0.5, limit: 0})).toEqual({
            path: 'a.ts',
            from: 1,
            to: 2000
        })
        expect(readCall('read', {path: 'a.ts', offset: 3.7, limit: 2.9})).toEqual({
            path: 'a.ts',
            from: 3,
            to: 4
        })
    })

    test('takes the numeric strings pi coerces before the tool runs', () => {
        expect(readCall('read', {path: 'a.ts', offset: '2001', limit: '100'})).toEqual({
            path: 'a.ts',
            from: 2001,
            to: 2100
        })
        expect(readCall('read', {path: 'a.ts', offset: 'ten', limit: ' '})).toEqual({
            path: 'a.ts',
            from: 1,
            to: 2000
        })
    })

    test('is undefined for other tools and malformed args', () => {
        expect(readCall('grep', {path: 'a.ts'})).toBeUndefined()
        expect(readCall('read', {})).toBeUndefined()
        expect(readCall('read', null)).toBeUndefined()
        expect(readCall('read', 'a.ts')).toBeUndefined()
    })
})

describe('readEnd', () => {
    const call = {path: 'a.ts', from: 1, to: 2000}
    test('keeps the span when the read was not cut short', () => {
        expect(readEnd(call, undefined, false)).toEqual(call)
        expect(readEnd(call, {content: [], details: undefined}, false)).toEqual(call)
        expect(readEnd(call, {content: [], details: truncated(2000)}, false)).toEqual(call)
    })

    test('ends the span at the last line pi returned', () => {
        expect(readEnd(call, {content: [], details: truncated(1300)}, false)).toEqual({
            ...call,
            to: 1300
        })
    })

    test('an error or a first line past the byte cap read no lines', () => {
        expect(readEnd(call, {content: []}, true)).toBeUndefined()
        expect(readEnd(call, {content: [], details: truncated(0)}, false)).toBeUndefined()
    })
})

describe('createVisited', () => {
    test('lists each read path once with its distinct spans', () => {
        const visited = createVisited()
        visited.onEvent(start('read', {path: 'a.ts'}))
        visited.onEvent(end('read', {path: 'a.ts'}))
        visited.onEvent(start('read', {path: 'a.ts'}))
        visited.onEvent(end('read', {path: 'a.ts'}))
        visited.onEvent(start('read', {path: 'a.ts', offset: 5, limit: 10}))
        visited.onEvent(end('read', {path: 'a.ts', offset: 5, limit: 10}))
        visited.onEvent(start('grep', {path: 'a.ts', pattern: 'x'}))
        visited.onEvent(end('grep', {path: 'a.ts', pattern: 'x'}))
        visited.onEvent(start('read', {path: 'b.ts', offset: 2}))
        visited.onEvent(end('read', {path: 'b.ts', offset: 2}))
        visited.dispose()

        expect(visited.list()).toBe(
            ' Its reads, gone with it: a.ts (lines 1-2000, 5-14), b.ts (lines 2-2001).'
        )
    })

    test('shortens a span to the lines pi actually returned', () => {
        const visited = createVisited()
        visited.onEvent(start('read', {path: 'a.ts'}))
        visited.onEvent(end('read', {path: 'a.ts'}, {details: truncated(1300)}))
        visited.onEvent(start('read', {path: 'a.ts', offset: 1301}))
        visited.onEvent(end('read', {path: 'a.ts', offset: 1301}))
        visited.onEvent(end('grep', {path: 'a.ts'}))

        expect(visited.list()).toBe(' Its reads, gone with it: a.ts (lines 1-1300, 1301-3300).')
    })

    test('skips a read that errored or never returned', () => {
        const visited = createVisited()
        visited.onEvent(start('read', {path: 'missing.ts'}))
        visited.onEvent(end('read', {path: 'missing.ts'}, {isError: true}))
        visited.onEvent(start('read', {path: 'hung.ts'}))
        visited.onEvent(end('grep', {path: 'a.ts'}))

        expect(visited.list()).toBe('')
    })

    test('is empty before any read', () => {
        expect(createVisited().list()).toBe('')
    })

    test('caps the list at forty paths and counts the rest', () => {
        const visited = createVisited()

        for (let i = 0; i < 43; i += 1) {
            visited.onEvent(start('read', {path: `f${i}.ts`}))
            visited.onEvent(end('read', {path: `f${i}.ts`}))
        }

        const list = visited.list()
        expect(list).toContain('f39.ts (lines 1-2000)')
        expect(list).not.toContain('f40.ts')
        expect(list).toEndWith(', and 3 more.')
    })
})
