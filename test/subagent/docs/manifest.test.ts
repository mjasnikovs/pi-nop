import {describe, expect, test} from 'bun:test'

import {readManifest, spec} from '../../../src/subagent/docs/manifest'
import {tempTree} from '../../tree'

describe('readManifest', () => {
    test('keeps the fields package.json promises and drops the rest', () => {
        const dir = tempTree({
            'package.json': {
                name: 'x',
                version: 7,
                homepage: ['a'],
                repository: {url: 'u'},
                dependencies: {a: '^1'},
                extra: 1,
                toString: 1
            }
        })
        expect(readManifest(dir)).toEqual({
            name: 'x',
            repository: {url: 'u'},
            dependencies: {a: '^1'}
        })
    })

    test('a manifest without a name is read; a project root or a nested type marker has none', () => {
        expect(readManifest(tempTree({'package.json': {version: '1.0.0'}}))).toEqual({
            version: '1.0.0'
        })
        expect(readManifest(tempTree({'package.json': {type: 'module'}}))).toEqual({})
    })
})

describe('spec', () => {
    test('name@version, or the name alone', () => {
        expect(spec({name: 'x', version: '1.0.0'})).toBe('x@1.0.0')
        expect(spec({name: 'x'})).toBe('x')
    })
})
