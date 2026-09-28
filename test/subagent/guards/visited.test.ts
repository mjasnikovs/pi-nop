import {describe, expect, test} from 'bun:test'

import {createVisited, readCall} from '../../../src/subagent/guards/visited'
import {end, start} from './fake'

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

    test('is undefined for other tools and malformed args', () => {
        expect(readCall('grep', {path: 'a.ts'})).toBeUndefined()
        expect(readCall('read', {})).toBeUndefined()
        expect(readCall('read', null)).toBeUndefined()
        expect(readCall('read', 'a.ts')).toBeUndefined()
    })
})

describe('createVisited', () => {
    test('lists each read path once with its distinct spans', () => {
        const visited = createVisited()
        visited.onEvent(start('read', {path: 'a.ts'}))
        visited.onEvent(end('read', {path: 'a.ts'}))
        visited.onEvent(start('read', {path: 'a.ts'}))
        visited.onEvent(start('read', {path: 'a.ts', offset: 5, limit: 10}))
        visited.onEvent(start('grep', {path: 'a.ts', pattern: 'x'}))
        visited.onEvent(start('read', {path: 'b.ts', offset: 2}))
        visited.dispose()

        expect(visited.list()).toBe(
            ' You have already read, do not re-open: a.ts (lines 1-2000, 5-14), b.ts (lines 2-2001).'
        )
    })

    test('is empty before any read', () => {
        expect(createVisited().list()).toBe('')
    })

    test('caps the list at forty paths and counts the rest', () => {
        const visited = createVisited()
        for (let i = 0; i < 43; i += 1) visited.onEvent(start('read', {path: `f${i}.ts`}))

        const list = visited.list()
        expect(list).toContain('f39.ts (lines 1-2000)')
        expect(list).not.toContain('f40.ts')
        expect(list).toEndWith(', and 3 more.')
    })
})
