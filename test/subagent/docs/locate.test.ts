import {describe, expect, mock, test} from 'bun:test'
import {mkdirSync, symlinkSync} from 'node:fs'
import {join} from 'node:path'

import {agentDir, getAgentDir, useAgentDir} from '../../agentDir'
import {tempTree as tree, writeTree} from '../../tree'

const actual = await import('@earendil-works/pi-coding-agent')
await mock.module('@earendil-works/pi-coding-agent', () => ({...actual, getAgentDir}))

const {
    assertPackage,
    locate,
    locateDownloaded,
    LocateErrors,
    locateIn,
    packageName,
    projectOf,
    typesModule
} = await import('../../../src/subagent/docs/locate')
useAgentDir()
const docsCache = join(agentDir, 'cache', 'pi-nop-docs')
describe('typesModule', () => {
    test('maps runtime modules to their types package', () => {
        expect(typesModule('node:fs')).toBe('node')
        expect(typesModule('fs')).toBe('node')
        expect(typesModule('fs/promises')).toBe('node')
        expect(typesModule('bun:sqlite')).toBe('bun')
        expect(typesModule('sqlite')).toBeUndefined()
        expect(typesModule('zod')).toBeUndefined()
    })
})

describe('assertPackage', () => {
    test('rejects what is not a package name', () => {
        for (const module of [
            '../etc',
            '.hidden',
            '@scope/',
            'a b',
            'zod@99',
            '/abs',
            './src/config',
            '--registry=x',
            'hono/../other',
            'hono/./x',
            'foo\\..\\..\\x',
            '@scope\\..\\x/y'
        ])
            expect(() => assertPackage(module)).toThrow(LocateErrors.BadName)
    })

    test('accepts plain, scoped and subpath names', () => {
        for (const module of [
            'zod',
            '@scope/name',
            'hono/client',
            '@scope/name/deep/path',
            'sqlite'
        ])
            expect(() => assertPackage(module)).not.toThrow()
    })
})

test('packageName keeps the scope and drops the subpath', () => {
    expect(packageName('zod')).toBe('zod')
    expect(packageName('hono/client')).toBe('hono')
    expect(packageName('@scope/name/sub')).toBe('@scope/name')
})

describe('projectOf', () => {
    test('finds the range in any dependency map of the nearest package.json', () => {
        const root = tree({
            'package.json': {name: 'app', devDependencies: {zod: '^3'}, peerDependencies: {x: '*'}},
            'src/deep/.keep': ''
        })
        expect(projectOf('zod', join(root, 'src/deep'))).toEqual({
            path: join(root, 'package.json'),
            range: '^3'
        })
        expect(projectOf('x', root).range).toBe('*')
        expect(projectOf('other', root)).toEqual({
            path: join(root, 'package.json'),
            range: undefined
        })
    })

    test('is empty with no package.json above', () => {
        expect(projectOf('zod', tree({}))).toEqual({})
    })
})

describe('locateIn', () => {
    test('finds a hoisted package above cwd and its types entry from the exports map', () => {
        const root = tree({
            'node_modules/lib/package.json': {
                name: 'lib',
                version: '1.2.3',
                exports: {'.': {types: './dist/index.d.mts'}, './sub': {types: './dist/sub.d.ts'}}
            },
            'node_modules/lib/dist/index.d.mts': 'export declare const a: 1',
            'node_modules/lib/dist/sub.d.ts': 'export declare const b: 2',
            'packages/app/.keep': ''
        })
        const cwd = join(root, 'packages/app')
        const main = locateIn('lib', cwd)
        expect(main?.pkg.manifest.version).toBe('1.2.3')
        expect(main?.entry).toBe(join(root, 'node_modules/lib/dist/index.d.mts'))
        expect(main?.types).toEqual([])
        expect(locateIn('lib/sub', cwd)?.entry).toBe(join(root, 'node_modules/lib/dist/sub.d.ts'))
    })

    test('follows a pnpm style symlink to the real package folder', () => {
        const root = tree({
            'node_modules/.pnpm/lib@1.0.0/node_modules/lib/package.json': {
                name: 'lib',
                version: '1.0.0',
                types: 'index.d.ts'
            },
            'node_modules/.pnpm/lib@1.0.0/node_modules/lib/index.d.ts': 'export {}'
        })
        symlinkSync(
            join(root, 'node_modules/.pnpm/lib@1.0.0/node_modules/lib'),
            join(root, 'node_modules/lib')
        )
        const found = locateIn('lib', root)
        expect(found?.pkg.dir).toBe(join(root, 'node_modules/.pnpm/lib@1.0.0/node_modules/lib'))
        expect(found?.entry).toBe(
            join(root, 'node_modules/.pnpm/lib@1.0.0/node_modules/lib/index.d.ts')
        )
    })

    test('takes @types when the package ships none, and a .js entry when nothing does', () => {
        const root = tree({
            'node_modules/lib/package.json': {name: 'lib', version: '2.0.0', main: 'lib.js'},
            'node_modules/lib/lib.js': 'module.exports = {}',
            'node_modules/@types/lib/package.json': {name: '@types/lib', version: '2.0.1'},
            'node_modules/@types/lib/index.d.ts': 'export declare const a: 1',
            'node_modules/bare/package.json': {name: 'bare', version: '0.1.0', main: 'bare.js'},
            'node_modules/bare/bare.js': ''
        })
        const typed = locateIn('lib', root)
        expect(typed?.types.map(pkg => pkg.manifest.name)).toEqual(['@types/lib'])
        expect(typed?.entry).toBe(join(root, 'node_modules/@types/lib/index.d.ts'))
        const bare = locateIn('bare', root)
        expect(bare?.types).toEqual([])
        expect(bare?.entry).toBe(join(root, 'node_modules/bare/bare.js'))
    })

    test('follows a statement free stub one hop, not further', () => {
        const root = tree({
            'node_modules/@types/rt/package.json': {name: '@types/rt', version: '1.0.0'},
            'node_modules/@types/rt/index.d.ts': '/// <reference types="rt-types" />\n',
            'node_modules/rt-types/package.json': {
                name: 'rt-types',
                version: '1.0.5',
                types: 'index.d.ts'
            },
            'node_modules/rt-types/index.d.ts':
                '/// <reference types="far" />\ndeclare const rt: 1\n',
            'node_modules/far/package.json': {name: 'far', version: '9.0.0', types: 'index.d.ts'},
            'node_modules/far/index.d.ts': 'declare const far: 1\n',
            'node_modules/rt/package.json': {name: 'rt', version: '1.0.0'}
        })
        const found = locateIn('rt', root)
        expect(found?.types.map(pkg => `${pkg.manifest.name}@${pkg.manifest.version}`)).toEqual([
            '@types/rt@1.0.0',
            'rt-types@1.0.5'
        ])
    })

    test('a stub with its own statements is not followed', () => {
        const root = tree({
            'node_modules/lib/package.json': {name: 'lib', version: '1.0.0', types: 'index.d.ts'},
            'node_modules/lib/index.d.ts':
                '/// <reference types="far" />\nexport declare const a: 1\n',
            'node_modules/far/package.json': {name: 'far', version: '9.0.0', types: 'index.d.ts'},
            'node_modules/far/index.d.ts': 'declare const far: 1\n'
        })
        expect(locateIn('lib', root)?.types).toEqual([])
    })

    test('reads the types package when only it is on disk', () => {
        const root = tree({
            'node_modules/@types/rt/package.json': {name: '@types/rt', version: '1.0.0'},
            'node_modules/@types/rt/index.d.ts': '/// <reference types="rt-types" />\n',
            'node_modules/rt-types/package.json': {
                name: 'rt-types',
                version: '1.0.5',
                types: 'index.d.ts'
            },
            'node_modules/rt-types/index.d.ts': 'declare const rt: 1\n'
        })
        const found = locateIn('rt', root)
        expect(found?.onDisk).toBe(false)
        expect(found?.pkg.manifest.name).toBe('@types/rt')
        expect(found?.types.map(pkg => pkg.manifest.name)).toEqual(['rt-types'])
    })

    test('ignores what resolves outside the tree it was told to stay in', () => {
        const root = tree({
            'node_modules/@types/lib/package.json': {name: '@types/lib', version: '9.9.9'},
            'node_modules/@types/lib/index.d.ts': 'export declare const stray: 1',
            'cache/lib@1.0.0/node_modules/lib/package.json': {
                name: 'lib',
                version: '1.0.0',
                main: 'lib.js'
            },
            'cache/lib@1.0.0/node_modules/lib/lib.js': ''
        })
        const cache = join(root, 'cache/lib@1.0.0')
        const loose = locateIn('lib', cache)
        expect(loose?.types.map(pkg => pkg.manifest.name)).toEqual(['@types/lib'])
        const fenced = locateDownloaded('lib', cache)
        expect(fenced?.types).toEqual([])
        expect(fenced?.entry).toBeUndefined()
    })

    test('a nameless project manifest and a nested type marker are stepped over', () => {
        const root = tree({
            'package.json': {private: true, dependencies: {lib: '^1'}},
            'node_modules/lib/package.json': {
                name: 'lib',
                version: '1.0.0',
                types: 'cjs/index.d.ts'
            },
            'node_modules/lib/cjs/package.json': {type: 'commonjs'},
            'node_modules/lib/cjs/index.d.ts': 'export {}'
        })
        expect(projectOf('lib', root)).toEqual({path: join(root, 'package.json'), range: '^1'})
        expect(locateIn('lib', root)?.pkg.manifest.name).toBe('lib')
    })

    test('is undefined when the package is not there', () => {
        expect(locateIn('lib', tree({}))).toBeUndefined()
    })
})

describe('locate', () => {
    test('uses the installed copy when the asked version matches, and names an alias', async () => {
        const root = tree({
            'node_modules/lib/package.json': {name: 'lib', version: '1.2.3', types: 'index.d.ts'},
            'node_modules/lib/index.d.ts': 'export {}',
            'node_modules/lib-alias/package.json': {
                name: 'lib',
                version: '1.2.3',
                types: 'index.d.ts'
            },
            'node_modules/lib-alias/index.d.ts': 'export {}'
        })
        const same = await locate('lib', root, {version: '1.2.3'})
        expect(same.source).toBe('installed')
        expect(same.asked).toBe('lib')
        const alias = await locate('lib-alias', root)
        expect(alias.asked).toBe('lib-alias')
        expect(alias.pkg.manifest.name).toBe('lib')
        expect(alias.types).toEqual([])
    })

    test('reads a runtime module from its types package, or says it is missing', async () => {
        const root = tree({
            'node_modules/@types/node/package.json': {
                name: '@types/node',
                version: '26.0.0',
                types: 'index.d.ts'
            },
            'node_modules/@types/node/index.d.ts': 'declare module "fs" {}'
        })
        const fs = await locate('node:fs', root)
        expect(fs.source).toBe('runtime')
        expect(fs.asked).toBe('node:fs')
        expect(fs.pkg.manifest.name).toBe('@types/node')
        await expect(locate('bun:test', root)).rejects.toThrow(LocateErrors.Builtin)
        await expect(locate('path', tree({}))).rejects.toThrow(LocateErrors.Builtin)
        await expect(locate('zod', root, {version: 'file:../x'})).rejects.toThrow(
            LocateErrors.BadVersion
        )
    })

    test('a declared or pinned builtin name is the npm package; an undeclared hoisted one is not', async () => {
        const root = tree({
            'node_modules/buffer/package.json': {
                name: 'buffer',
                version: '6.0.3',
                types: 'index.d.ts'
            },
            'node_modules/buffer/index.d.ts': 'export {}',
            'node_modules/@types/node/package.json': {
                name: '@types/node',
                version: '26.0.0',
                types: 'index.d.ts'
            },
            'node_modules/@types/node/index.d.ts': 'declare module "buffer" {}'
        })
        expect((await locate('buffer', root, {range: '^6'})).source).toBe('installed')
        expect((await locate('buffer', root, {version: '6.0.3'})).source).toBe('installed')
        expect((await locate('buffer', root)).source).toBe('runtime')
        expect((await locate('node:buffer', root)).source).toBe('runtime')
    })

    test('the bun binary package is not bun types, and steps aside when @types/bun is there', async () => {
        const root = tree({
            'node_modules/bun/package.json': {name: 'bun', version: '1.4.2'},
            'node_modules/bun/README.md': 'the binary'
        })
        await expect(locate('bun:test', root)).rejects.toThrow(LocateErrors.Builtin)
        const typed = tree({
            'node_modules/bun/package.json': {name: 'bun', version: '1.4.2'},
            'node_modules/@types/bun/package.json': {name: '@types/bun', version: '1.4.2'},
            'node_modules/@types/bun/index.d.ts': '/// <reference types="bun-types" />\n',
            'node_modules/bun-types/package.json': {
                name: 'bun-types',
                version: '1.4.2',
                types: 'index.d.ts'
            },
            'node_modules/bun-types/index.d.ts': 'declare module "bun:test" {}\n'
        })
        const found = await locate('bun:test', typed)
        expect(found.pkg.manifest.name).toBe('@types/bun')
        expect(found.types.map(pkg => pkg.manifest.name)).toEqual(['bun-types'])
    })

    test('a downloaded tree keeps no stub target from outside the cache', () => {
        const root = tree({
            'node_modules/far/package.json': {name: 'far', version: '1.0.0', types: 'index.d.ts'},
            'node_modules/far/index.d.ts': 'declare const far: 1\n',
            'cache/@types+rt@1.0.0/node_modules/@types/rt/package.json': {
                name: '@types/rt',
                version: '1.0.0'
            },
            'cache/@types+rt@1.0.0/node_modules/@types/rt/index.d.ts':
                '/// <reference types="far" />\n'
        })
        const found = locateDownloaded('@types/rt', join(root, 'cache/@types+rt@1.0.0'))
        expect(found?.types).toEqual([])
    })

    test('another version comes from the cache, naming the installed one', async () => {
        writeTree(join(docsCache, 'lib@2.0.0', 'node_modules', 'lib'), {
            'package.json': {name: 'lib', version: '2.0.0', types: 'index.d.ts'},
            'index.d.ts': 'export {}'
        })
        const root = tree({'node_modules/lib/package.json': {name: 'lib', version: '1.0.0'}})
        const other = await locate('lib', root, {version: '2.0.0'})
        expect(other.source).toBe('downloaded')
        expect(other.pkg.manifest.version).toBe('2.0.0')
        expect(other.installed).toBe('1.0.0')
        const fresh = await locate('lib', tree({}), {version: '2.0.0'})
        expect(fresh.source).toBe('downloaded')
        expect(fresh.installed).toBeUndefined()
    })

    test('a cached tree without the package is reported, not read', async () => {
        mkdirSync(join(docsCache, 'empty@1.0.0'), {recursive: true})
        await expect(locate('empty', tree({}), {version: '1.0.0'})).rejects.toThrow(
            LocateErrors.NotUnpacked
        )
    })
})
