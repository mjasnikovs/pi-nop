import {afterAll, describe, expect, mock, test} from 'bun:test'
import {existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {agentDir, getAgentDir, useAgentDir} from '../../agentDir'
import {tempTree} from '../../tree'
import {packument, serveRegistry, tarball, tarballPath} from './registry'
import type {Packument} from './registry'

const actual = await import('@earendil-works/pi-coding-agent')
await mock.module('@earendil-works/pi-coding-agent', () => ({...actual, getAgentDir}))

const {download, facts, packTarget, resolveVersion, view} =
    await import('../../../src/subagent/docs/npm')

const docs: Record<string, Packument> = {
    '/zod': packument('zod', '4.6.5', {'3.23.8': {}, '4.6.5': {}, '9.0.0-beta.1': {}}),
    '/request': packument('request', '2.88.2', {
        '2.88.2': {deprecated: 'request has been deprecated'}
    }),
    '/left-pad': packument('left-pad', '1.3.0', {'1.3.0': {}}),
    '/broken': packument('broken', '1.0.0', {'1.0.0': {}}),
    '/@acme%2fsdk': packument('@acme/sdk', '1.0.0', {'1.0.0': {}}),
    '/untagged': {...packument('untagged', '1.0.0', {'1.0.0': {}}), 'dist-tags': {}}
}
const tarballs = {
    [tarballPath('left-pad', '1.3.0')]: tarball({
        'package.json': {name: 'left-pad', version: '1.3.0'},
        'index.js': 'module.exports = pad'
    }),
    [tarballPath('broken', '1.0.0')]: new TextEncoder().encode('not a tarball')
}
let scopedHits = 0
let mainHits = 0
useAgentDir()
const main = serveRegistry(docs, tarballs, () => {
    mainHits++
})
const scoped = serveRegistry(docs, tarballs, () => {
    scopedHits++
})
process.env.npm_config_registry = `http://127.0.0.1:${main.port}/`
process.env['npm_config_@acme:registry'] = `http://127.0.0.1:${scoped.port}/`
const cwd = process.cwd()
afterAll(() => {
    delete process.env.npm_config_registry
    delete process.env['npm_config_@acme:registry']
    void main.stop()
    void scoped.stop()
})

describe('view', () => {
    test('resolves a version, a tag and a range to one version, with latest alongside', async () => {
        expect(await view({name: 'zod', spec: '3.23.8'}, cwd)).toEqual({
            version: '3.23.8',
            deprecated: undefined,
            latest: '4.6.5'
        })
        expect((await view({name: 'zod', spec: 'beta'}, cwd)).version).toBe('9.0.0-beta.1')
        expect((await view({name: 'zod', spec: '^4'}, cwd)).version).toBe('4.6.5')
    })

    // On Windows npm runs through cmd.exe, where ^ < > | and spaces are syntax.
    test('a range with shell characters reaches npm as written', async () => {
        expect((await view({name: 'zod', spec: '>=3 <4'}, cwd)).version).toBe('3.23.8')
        expect((await view({name: 'zod', spec: '^3 || ^4'}, cwd)).version).toBe('4.6.5')
        const root = await download('pad-range', {name: 'left-pad', spec: '>=1 <2'}, cwd)
        expect(existsSync(join(root, 'node_modules', 'pad-range', 'index.js'))).toBe(true)
    })

    // On Windows the lookup tried the project folder before PATH, so a cloned repo's npm.cmd ran.
    test('an npm in the project folder is never run in place of the one on PATH', async () => {
        const planted = '@echo off\r\necho ran> "%~dp0ran"\r\nexit /b 1\r\n'
        const project = tempTree({'npm.cmd': planted, 'npm.bat': planted})
        expect((await view({name: 'zod', spec: '^4'}, project)).version).toBe('4.6.5')
        expect(existsSync(join(project, 'ran'))).toBe(false)
    })

    // An npm.cmd with no node.exe beside it, as npm i -g npm writes, calls a bare node.
    test.skipIf(process.platform !== 'win32')(
        'a node in the project folder is never run by npm.cmd',
        async () => {
            const shim = tempTree({
                'npm.cmd': '@node "%~dp0view.js"\r\n',
                'view.js': `process.stdout.write('{"version":"1.0.0","dist-tags.latest":"1.0.0"}')`
            })
            const project = tempTree({'node.cmd': '@echo ran> "%~dp0ran"\r\n'})
            const path = process.env.PATH
            process.env.PATH = `${shim};${path}`

            try {
                expect((await view({name: 'zod', spec: '^4'}, project)).version).toBe('1.0.0')
                expect(existsSync(join(project, 'ran'))).toBe(false)
            } finally {
                process.env.PATH = path
            }
        }
    )

    test('a silent npm still reports a missing package as missing', async () => {
        process.env.npm_config_loglevel = 'silent'

        try {
            await expect(view({name: 'nope', spec: 'latest'}, cwd)).rejects.toThrow(
                'not on npm: nope@latest (E404)'
            )
            await expect(
                download('left-pad', {name: 'left-pad', spec: '99.0.0'}, cwd)
            ).rejects.toThrow('not on npm: left-pad@99.0.0 (ETARGET)')
        } finally {
            delete process.env.npm_config_loglevel
        }
    })

    test('a warning on stderr does not hide the code a silent npm prints on stdout', async () => {
        const warn = join(
            tempTree({'warn.cjs': "process.stderr.write('a warning\\n')"}),
            'warn.cjs'
        )
        process.env.npm_config_loglevel = 'silent'
        // NODE_OPTIONS reads a backslash in quotes as an escape.
        process.env.NODE_OPTIONS = `--require "${warn.replaceAll('\\', '/')}"`

        try {
            await expect(view({name: 'nope', spec: 'latest'}, cwd)).rejects.toThrow(
                'not on npm: nope@latest (E404)'
            )
        } finally {
            delete process.env.npm_config_loglevel
            delete process.env.NODE_OPTIONS
        }
    })

    // which reads a quoted PATH entry, and an empty PATHEXT entry must not match the bare npm script.
    test.skipIf(process.platform !== 'win32')(
        'a quoted PATH entry is searched and an extensionless npm is skipped',
        async () => {
            const shim = tempTree({
                'npm.cmd': '@node "%~dp0view.js"\r\n',
                'view.js': `process.stdout.write('{"version":"1.0.0","dist-tags.latest":"1.0.0"}')`
            })
            const bare = tempTree({npm: '#!/bin/sh\nexit 1\n'})
            const {PATH: path, PATHEXT: extensions} = process.env
            process.env.PATH = `${bare};"${shim}";${path}`
            process.env.PATHEXT = `${extensions};`

            try {
                expect((await view({name: 'zod', spec: '^4'}, cwd)).version).toBe('1.0.0')
            } finally {
                process.env.PATH = path
                process.env.PATHEXT = extensions
            }
        }
    )

    test('a project folder that is gone is not reported as a missing npm', async () => {
        const gone = join(tempTree({}), 'gone')
        const failure = view({name: 'zod', spec: '^4'}, gone)
        await expect(failure).rejects.toThrow('npm failed: zod@^4')
        await expect(failure).rejects.not.toThrow('npm was not found')
    })

    test('no npm on PATH fails as npm failing, not as a missing package', async () => {
        const path = process.env.PATH
        process.env.PATH = ''

        try {
            await expect(view({name: 'zod', spec: '^4'}, cwd)).rejects.toThrow(
                new Error('npm failed: zod@^4 (npm was not found)')
            )
        } finally {
            process.env.PATH = path
        }
    })

    test('a missing package or version is "not on npm"', async () => {
        await expect(view({name: 'nope', spec: 'latest'}, cwd)).rejects.toThrow(
            'not on npm: nope@latest (E404)'
        )
        await expect(view({name: 'zod', spec: '99.0.0'}, cwd)).rejects.toThrow(
            'not on npm: zod@99.0.0'
        )
    })

    test('a package with no latest tag is "not on npm", not a JSON error', async () => {
        await expect(view({name: 'untagged', spec: 'latest'}, cwd)).rejects.toThrow(
            'not on npm: untagged@latest (empty)'
        )
    })

    test('a package with no latest tag still answers for an exact version', async () => {
        expect(await view({name: 'untagged', spec: '1.0.0'}, cwd)).toEqual({
            version: '1.0.0',
            deprecated: undefined,
            latest: undefined
        })
    })

    test('a scoped name goes through npm to its scope registry', async () => {
        expect((await view({name: '@acme/sdk', spec: 'latest'}, cwd)).version).toBe('1.0.0')
        expect(scopedHits).toBeGreaterThan(0)
    })

    // On Windows npm runs under cmd.exe, and killing cmd.exe alone leaves npm running.
    test('an abort stops npm itself, so its registry request drops', async () => {
        const asked = Promise.withResolvers<Request>()
        const held = Bun.serve({
            port: 0,
            fetch: request => {
                asked.resolve(request)
                return new Promise<Response>(() => undefined)
            }
        })
        process.env['npm_config_@held:registry'] = `http://127.0.0.1:${held.port}/`
        const controller = new AbortController()

        try {
            const viewing = view({name: '@held/pkg', spec: 'latest'}, cwd, controller.signal)
            const request = await asked.promise
            const dropped = new Promise(resolve =>
                request.signal.addEventListener('abort', resolve)
            )
            controller.abort()
            await expect(viewing).rejects.toThrow('Subagent aborted')
            await dropped
        } finally {
            delete process.env['npm_config_@held:registry']
            void held.stop(true)
        }
    })

    test('an abort is reported as an abort', async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(view({name: 'zod', spec: 'latest'}, cwd, controller.signal)).rejects.toThrow(
            'Subagent aborted'
        )
    })
})

describe('facts', () => {
    test('latest and the deprecation of the version in hand', async () => {
        expect(await facts('zod', '3.23.8', cwd)).toEqual({latest: '4.6.5', deprecated: undefined})
        expect(await facts('request', '2.88.2', cwd)).toEqual({
            latest: '2.88.2',
            deprecated: 'request has been deprecated'
        })
        expect(await facts('zod', undefined, cwd)).toEqual({latest: '4.6.5', deprecated: undefined})
    })

    test('a version the registry never saw still leaves latest known; a missing package is an error', async () => {
        expect(await facts('left-pad', '9.9.9', cwd)).toEqual({
            latest: '1.3.0',
            deprecated: undefined
        })
        expect(await facts('nope', '1.0.0', cwd)).toEqual({error: 'not on npm: nope@latest (E404)'})
    })
})

describe('resolveVersion', () => {
    test('a tag becomes the version it names; a version, a range or nothing is left alone', async () => {
        expect(await resolveVersion('zod', {version: 'beta'}, cwd)).toEqual({
            version: '9.0.0-beta.1'
        })
        for (const wanted of [{}, {version: '3.23.8'}, {version: '^4'}])
            expect(await resolveVersion('zod', wanted, cwd)).toEqual(wanted)
    })
})

describe('packTarget', () => {
    test('an asked version wins, then the declared range, then latest', () => {
        expect(packTarget('zod', {version: '3.0.0', range: '^4'})).toEqual({
            name: 'zod',
            spec: '3.0.0'
        })
        expect(packTarget('zod', {range: '^4'})).toEqual({name: 'zod', spec: '^4'})
        expect(packTarget('zod', {})).toEqual({name: 'zod', spec: 'latest'})
    })

    test('an npm alias names its target, with or without a version; a range from outside the registry is refused', () => {
        expect(packTarget('ms-alias', {range: 'npm:ms@2.1.3'})).toEqual({name: 'ms', spec: '2.1.3'})
        expect(packTarget('ms-alias', {range: 'npm:ms@^2', version: '2.0.0'})).toEqual({
            name: 'ms',
            spec: '2.0.0'
        })
        expect(packTarget('ms-alias', {range: 'npm:@scope/ms'})).toEqual({
            name: '@scope/ms',
            spec: 'latest'
        })

        for (const range of ['workspace:*', 'file:../x', 'github:a/b', 'https://x/y.tgz']) {
            expect(() => packTarget('zod', {range})).toThrow(
                'declared from outside the registry: zod'
            )
            expect(() => packTarget('zod', {range, version: '2.0.0'})).toThrow(
                'declared from outside the registry: zod'
            )
        }
    })
})

describe('download', () => {
    test('an exact version already in the cache costs no npm call', async () => {
        const root = join(agentDir, 'cache', 'pi-nop-docs', 'zod@3.23.8')
        mkdirSync(join(root, 'node_modules', 'zod'), {recursive: true})
        writeFileSync(
            join(root, 'node_modules', 'zod', 'package.json'),
            '{"name":"zod","version":"3.23.8"}'
        )
        const before = mainHits
        expect(await download('zod', {name: 'zod', spec: '3.23.8'}, cwd)).toBe(root)
        expect(mainHits).toBe(before)
    })

    const cache = join(agentDir, 'cache', 'pi-nop-docs')
    const scratchLeft = () => readdirSync(cache).filter(name => name.startsWith('pack-'))
    test('a tag is looked up and unpacked under its exact version, then served from the cache', async () => {
        const root = await download('left-pad', {name: 'left-pad', spec: 'latest'}, cwd)
        expect(root).toBe(join(cache, 'left-pad@1.3.0'))
        expect(readFileSync(join(root, 'node_modules', 'left-pad', 'index.js'), 'utf8')).toBe(
            'module.exports = pad'
        )
        expect(scratchLeft()).toEqual([])
        const before = mainHits
        expect(await download('left-pad', {name: 'left-pad', spec: '1.3.0'}, cwd)).toBe(root)
        expect(mainHits).toBe(before)
    })

    test('an alias is unpacked under the asked name and keyed by both names', async () => {
        const root = await download('pad-alias', {name: 'left-pad', spec: '1.3.0'}, cwd)
        expect(root).toBe(join(cache, 'pad-alias=left-pad@1.3.0'))
        expect(existsSync(join(root, 'node_modules', 'pad-alias', 'index.js'))).toBe(true)
    })

    test('a range goes straight to npm pack, and a tree already in place is kept', async () => {
        const root = join(cache, 'left-pad@1.3.0')
        mkdirSync(join(root, 'node_modules', 'left-pad'), {recursive: true})
        writeFileSync(join(root, 'first'), '')
        expect(await download('left-pad', {name: 'left-pad', spec: '^1'}, cwd)).toBe(root)
        expect(existsSync(join(root, 'first'))).toBe(true)
        expect(scratchLeft()).toEqual([])
    })

    // Windows renames over a dangling link, so there the move does not fail.
    test.skipIf(process.platform === 'win32')(
        'a lost move with nothing in its place fails and leaves no scratch behind',
        async () => {
            mkdirSync(cache, {recursive: true})
            symlinkSync(join(cache, 'nowhere'), join(cache, 'gone=left-pad@1.3.0'))
            await expect(download('gone', {name: 'left-pad', spec: '1.3.0'}, cwd)).rejects.toThrow(
                'ENOTDIR'
            )
            expect(scratchLeft()).toEqual([])
        }
    )

    test('a tarball tar cannot read fails and leaves no scratch behind', async () => {
        await expect(download('broken', {name: 'broken', spec: '1.0.0'}, cwd)).rejects.toThrow()
        expect(existsSync(join(cache, 'broken@1.0.0'))).toBe(false)
        expect(scratchLeft()).toEqual([])
    })
})
