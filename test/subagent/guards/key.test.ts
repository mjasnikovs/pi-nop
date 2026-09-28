import {describe, expect, test} from 'bun:test'

import {callKey} from '../../../src/subagent/guards/key'

describe('callKey', () => {
    test('ignores key order at every depth and keeps array order', () => {
        expect(callKey('grep', {path: 'src', pattern: 'a', nested: {b: 1, a: [2, 1]}})).toBe(
            callKey('grep', {nested: {a: [2, 1], b: 1}, pattern: 'a', path: 'src'})
        )
        expect(callKey('grep', {list: [1, 2]})).not.toBe(callKey('grep', {list: [2, 1]}))
    })

    test('tells tools, args and scalars apart', () => {
        expect(callKey('read', {path: 'a'})).not.toBe(callKey('ls', {path: 'a'}))
        expect(callKey('read', {path: 'a'})).not.toBe(callKey('read', {path: 'b'}))
        expect(callKey('read', 'a')).toBe('read "a"')
        expect(callKey('read', null)).toBe('read null')
    })
})
