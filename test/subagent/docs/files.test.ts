import {describe, expect, test} from 'bun:test'
import {mkdirSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {corpusOf, packageFiles} from '../../../src/subagent/docs/files'
import {entryOf, located, pkg} from './located'

describe('packageFiles', () => {
    test('takes declarations anywhere, the root readme in any case, and package.json', () => {
        const p = pkg({
            'index.d.ts': '',
            'lib/a.d.mts': '',
            'lib/b.d.cts': '',
            'lib/b.js': '',
            'README.markdown': '',
            'docs/readme.md': '',
            'src/index.ts': ''
        })
        expect(packageFiles(p)).toEqual([
            'README.markdown',
            'index.d.ts',
            'lib/a.d.mts',
            'lib/b.d.cts',
            'package.json'
        ])
    })

    test('skips a nested node_modules and anything behind a symlink, and survives a loop', () => {
        const p = pkg({'index.d.ts': '', 'node_modules/dep/index.d.ts': '', 'sub/a.d.ts': ''})
        mkdirSync(join(p.dir, 'outside'))
        writeFileSync(join(p.dir, 'outside', 'x.d.ts'), '')
        symlinkSync(join(p.dir, 'outside'), join(p.dir, 'linked'))
        symlinkSync(join(p.dir, 'outside', 'x.d.ts'), join(p.dir, 'y.d.ts'))
        symlinkSync('..', join(p.dir, 'sub', 'loop'))
        expect(packageFiles(p)).toEqual([
            'index.d.ts',
            'outside/x.d.ts',
            'package.json',
            'sub/a.d.ts'
        ])
    })

    test('drops a top-level vN folder of another major unless asked to keep it', () => {
        const p = pkg({'v3/index.d.ts': '', 'v4/index.d.ts': '', 'v4/deep/x.d.ts': ''}, '4.2.1')
        expect(packageFiles(p)).toEqual(['package.json', 'v4/deep/x.d.ts', 'v4/index.d.ts'])
        const zod325 = pkg({'v3/index.d.ts': '', 'v4/index.d.ts': '', 'index.d.ts': ''}, '3.25.76')
        expect(packageFiles(zod325)).toEqual(['index.d.ts', 'package.json', 'v3/index.d.ts'])
        expect(packageFiles(zod325, 'v4/')).toEqual([
            'index.d.ts',
            'package.json',
            'v3/index.d.ts',
            'v4/index.d.ts'
        ])
    })

    test('vN folders are namespaces, not layers, unless the package has one for its own major', () => {
        const namespaces = pkg({'v1/a.d.ts': '', 'v2/b.d.ts': '', 'index.d.ts': ''}, '3.0.0')
        expect(packageFiles(namespaces)).toEqual([
            'index.d.ts',
            'package.json',
            'v1/a.d.ts',
            'v2/b.d.ts'
        ])
    })

    test('a manifest without a version keeps every folder', () => {
        const p = {manifest: {name: 'pkg'}, dir: pkg({'v3/a.d.ts': '', 'v9/b.d.ts': ''}).dir}
        expect(packageFiles(p)).toEqual(['package.json', 'v3/a.d.ts', 'v9/b.d.ts'])
    })
})

describe('corpusOf', () => {
    test('keeps one copy of identical twin files, code by whole lines, readme by sentence', () => {
        const p = pkg({'index.d.ts': 'export {}', 'index.d.cts': 'export {}', 'README.md': 'hi'})
        const corpus = corpusOf(located(p))
        expect(corpus.files.map(file => [file.label, file.wholeLines])).toEqual([
            ['pkg/README.md', false],
            ['pkg/index.d.cts', true],
            ['pkg/package.json', true]
        ])
        expect(corpus.declared).toBe(true)
        expect(corpus.standIn).toBeUndefined()
    })

    test('keeps the major folder the entry resolves into', () => {
        const p = pkg(
            {'v3/index.d.ts': 'three', 'v4/index.d.ts': 'four', 'index.d.ts': 'root'},
            '3.25.76'
        )
        const paths = corpusOf(located(p, {entry: entryOf(p, 'v4/index.d.ts')})).files.map(
            file => file.label
        )
        expect(paths).toContain('pkg/v4/index.d.ts')
    })

    test('lets the entry source stand in only when nothing declares types', () => {
        const p = pkg({'index.js': 'module.exports = 1', 'README.md': 'hi'})
        const bare = corpusOf(located(p, {entry: entryOf(p, 'index.js')}))
        expect(bare.files.map(file => file.label)).toEqual([
            'pkg/README.md',
            'pkg/package.json',
            'pkg/index.js'
        ])
        expect(bare.declared).toBe(false)
        expect(bare.standIn).toBe('index.js')
        const types = pkg({'index.d.ts': 'export declare const x: 1'}, '4.0.1', '@types/pkg')
        const typed = corpusOf(located(p, {entry: entryOf(p, 'index.js'), types: [types]}))
        expect(typed.files.map(file => file.label)).toEqual([
            'pkg/README.md',
            'pkg/package.json',
            '@types/pkg/index.d.ts',
            '@types/pkg/package.json'
        ])
        expect(typed.declared).toBe(true)
        expect(typed.standIn).toBeUndefined()
    })
})
