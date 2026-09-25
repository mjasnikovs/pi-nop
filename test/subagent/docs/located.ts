import {join} from 'node:path'

import type {Located, Package} from '../../../src/subagent/docs/locate'
import type {Manifest} from '../../../src/subagent/docs/manifest'
import {tempTree} from '../../tree'

// A package on disk from a file map, package.json added, at a fresh temp folder.
const pkg = (files: Record<string, string>, version = '4.0.0', name = 'pkg'): Package => ({
    manifest: {name, version},
    dir: tempTree({...files, 'package.json': {name, version}})
})

// A package by name only, for header tests that never touch the disk.
const named = (name: string, version?: string, extra: Partial<Manifest> = {}): Package => ({
    manifest: {name, version, ...extra},
    dir: `/m/${name}`
})

const located = (main: Package, over: Partial<Located> = {}): Located => ({
    asked: main.manifest.name,
    pkg: main,
    source: 'installed',
    types: [],
    ...over
})

const entryOf = (main: Package, path: string): string => join(main.dir, path)

export {entryOf, located, named, pkg}
