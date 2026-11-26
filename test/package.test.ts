import {describe, expect, test} from 'bun:test'
import {readdirSync, readFileSync} from 'node:fs'
import {isBuiltin} from 'node:module'
import {join} from 'node:path'

import {packageName} from '../src/subagent/docs/locate'

type Manifest = {
    files: string[]
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    pi: {extensions: string[]}
}

const root = join(import.meta.dir, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest
// pi supplies these to every extension (pi docs, packages.md).
const hostPackages = [
    '@earendil-works/pi-ai',
    '@earendil-works/pi-agent-core',
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-tui',
    'typebox'
]

const sources = readdirSync(join(root, 'src'), {recursive: true, encoding: 'utf8'}).filter(
    path => path.endsWith('.ts') && !path.endsWith('.d.ts')
)
const transpiler = new Bun.Transpiler({loader: 'ts'})
const runtimePackages = [
    ...new Set(
        sources.flatMap(path =>
            transpiler
                .scanImports(readFileSync(join(root, 'src', path), 'utf8'))
                .map(entry => entry.path)
                .filter(module => !module.startsWith('.') && !isBuiltin(module))
                .map(packageName)
        )
    )
]
describe('package.json', () => {
    test('ships every extension entry pi loads', () => {
        const shipped = (path: string): boolean =>
            manifest.files.some(entry => path.replace(/^\.\//, '').startsWith(`${entry}/`))
        expect(manifest.pi.extensions.filter(path => !shipped(path))).toEqual([])
    })

    test('host packages are "*" peers, not dependencies', () => {
        const dependencies = Object.keys(manifest.dependencies ?? {})
        expect(dependencies.filter(name => hostPackages.includes(name))).toEqual([])
        for (const name of hostPackages) expect(manifest.peerDependencies?.[name]).toBe('*')
    })

    test('every package src imports at runtime gets installed', () => {
        const installed = [...Object.keys(manifest.dependencies ?? {}), ...hostPackages]
        expect(runtimePackages.length).toBeGreaterThan(0)
        expect(runtimePackages.filter(name => !installed.includes(name))).toEqual([])
    })
})
