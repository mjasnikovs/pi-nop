import {existsSync, realpathSync} from 'node:fs'
import {isBuiltin} from 'node:module'
import {dirname, join, sep} from 'node:path'
import ts from 'typescript'

import {isNamed, readManifest} from './manifest'
import type {Named} from './manifest'
import {download, packTarget, resolveVersion, versionPattern} from './npm'
import type {Wanted} from './npm'

enum LocateErrors {
    Builtin = 'Docs failed: runtime module without its types package installed: ',
    BadName = 'Docs failed: not an npm package name: ',
    BadVersion = 'Docs failed: not a version or dist-tag: ',
    NoManifest = 'Docs failed: no package.json for ',
    NotUnpacked = 'Docs failed: unpacked but not found: '
}

type Package = {
    manifest: Named
    dir: string
}

type Origin = 'installed' | 'downloaded' | 'types-only' | 'runtime'

type Located = {
    /** The name asked for; the folder name under an npm alias, `node:fs` for a runtime module. */
    asked: string
    pkg: Package
    source: Origin
    entry?: string
    /** Other packages that hold the declarations: @types/x, or what a one-line stub points at. */
    types: Package[]
    /** The version on disk, when a downloaded one was asked for instead. */
    installed?: string
}

type Project = {
    path?: string
    range?: string
}

const resolveOptions: ts.CompilerOptions = {moduleResolution: ts.ModuleResolutionKind.Bundler}
const packageNamePattern = /^(@[^/\s@:]+\/)?[^./\s@:-][^/\s@:]*$/
const runtimePrefix = /^(node|bun):/

const packageName = (module: string): string => {
    const parts = module.split('/')
    return parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? module)
}

const typesModule = (module: string): string | undefined => {
    if (module.startsWith('bun:')) return 'bun'
    return module.startsWith('node:') || isBuiltin(module) ? 'node' : undefined
}

// A subpath segment of `.` or `..` would resolve into another package.
const assertPackage = (module: string): void => {
    const dotted = module.split('/').some(segment => segment === '.' || segment === '..')

    if (dotted || !packageNamePattern.test(packageName(module)))
        throw new Error(LocateErrors.BadName + module)
}

const findUp = (from: string, test: (dir: string) => boolean): string | undefined => {
    for (let dir = from; ; dir = dirname(dir)) {
        if (test(dir)) return dir
        if (dirname(dir) === dir) return undefined
    }
}

const hasManifest = (dir: string): boolean => existsSync(join(dir, 'package.json'))

const readPackage = (dir: string): Package => {
    const manifest = readManifest(dir)

    if (!isNamed(manifest)) throw new Error(LocateErrors.NoManifest + dir)
    return {manifest, dir}
}

const packages = (located: Located): Package[] => [located.pkg, ...located.types]

const projectOf = (name: string, cwd: string): Project => {
    const dir = findUp(cwd, hasManifest)

    if (dir === undefined) return {}

    const manifest = readManifest(dir)
    const range =
        manifest.dependencies?.[name]
        ?? manifest.devDependencies?.[name]
        ?? manifest.peerDependencies?.[name]
        ?? manifest.optionalDependencies?.[name]
    return {path: join(dir, 'package.json'), range}
}

const findPackageDir = (name: string, cwd: string): string | undefined => {
    const dir = findUp(cwd, here => hasManifest(join(here, 'node_modules', name)))
    return dir === undefined ? undefined : realpathSync(join(dir, 'node_modules', name))
}

const packageRootOf = (file: string, name: string): string => {
    const dir = findUp(dirname(file), here => hasManifest(here) && readManifest(here).name === name)

    if (dir === undefined) throw new Error(`${LocateErrors.NoManifest}${name} above ${file}`)
    return dir
}

// One hop only: bun-types references node, which is not the package asked about.
const stubTargets = (entry: string): Package[] => {
    const text = ts.sys.readFile(entry) ?? ''

    if (ts.createSourceFile(entry, text, ts.ScriptTarget.Latest).statements.length > 0) return []
    return ts.preProcessFile(text).typeReferenceDirectives.flatMap(({fileName}) => {
        const resolved = ts.resolveTypeReferenceDirective(
            fileName,
            entry,
            {},
            ts.sys
        ).resolvedTypeReferenceDirective
        const name = resolved?.packageId?.name

        if (name === undefined || resolved?.resolvedFileName === undefined) return []
        return [readPackage(packageRootOf(realpathSync(resolved.resolvedFileName), name))]
    })
}

// TypeScript resolves relative to a containing file, which need not exist.
const resolveEntry = (module: string, cwd: string): ts.ResolvedModuleFull | undefined => {
    const resolved = ts.resolveModuleName(
        module,
        join(cwd, 'pi-nop.ts'),
        resolveOptions,
        ts.sys
    ).resolvedModule

    if (resolved === undefined) return undefined
    return {...resolved, resolvedFileName: realpathSync(resolved.resolvedFileName)}
}

// The package a resolved entry belongs to: the asked one, or @types/x when that answered.
const packageOf = (resolved?: ts.ResolvedModuleFull): Package | undefined => {
    const name = resolved?.packageId?.name

    if (resolved === undefined || name === undefined) return undefined
    return readPackage(packageRootOf(resolved.resolvedFileName, name))
}

// @types/x answered for x. Under an npm alias the names match and nothing is added.
const typesFor = (pkg: Package, resolved: Package | undefined, stubs: Package[]): Package[] => {
    if (resolved === undefined || resolved.manifest.name === pkg.manifest.name) return stubs
    return [resolved, ...stubs]
}

type Found = Omit<Located, 'asked' | 'source'> & {onDisk: boolean}

const asLocated = (asked: string, source: Origin, {onDisk: _onDisk, ...found}: Found): Located => ({
    asked,
    source,
    ...found
})

const packageAt = (
    module: string,
    cwd: string,
    resolved?: ts.ResolvedModuleFull
): Found | undefined => {
    const dir = findPackageDir(packageName(module), cwd)
    const resolvedPackage = packageOf(resolved)
    const pkg = dir === undefined ? resolvedPackage : readPackage(dir)

    if (pkg === undefined) return undefined

    const stubs =
        resolved?.extension.startsWith('.d.') === true ? stubTargets(resolved.resolvedFileName) : []
    return {
        pkg,
        entry: resolved?.resolvedFileName,
        types: typesFor(pkg, resolvedPackage, stubs),
        onDisk: dir !== undefined
    }
}

// Only a package on disk can satisfy a version; @types/x carries its own numbering.
const matchesVersion = (local: Found, version?: string): boolean =>
    version === undefined || (local.onDisk && version === local.pkg.manifest.version)

const locateIn = (module: string, cwd: string): Found | undefined =>
    packageAt(module, cwd, resolveEntry(module, cwd))

// A tree unpacked into the cache must not pick up a stray @types from an ancestor node_modules.
const locateDownloaded = (module: string, root: string): Found | undefined => {
    const fence = realpathSync(root) + sep
    const resolved = resolveEntry(module, root)
    const inside = resolved?.resolvedFileName.startsWith(fence) === true
    const found = packageAt(module, root, inside ? resolved : undefined)

    if (found === undefined) return undefined
    return {...found, types: found.types.filter(pkg => pkg.dir.startsWith(fence))}
}

const locate = async (
    module: string,
    cwd: string,
    wanted: Wanted = {},
    signal?: AbortSignal
): Promise<Located> => {
    const prefixed = runtimePrefix.test(module)

    if (!prefixed) assertPackage(module)
    if (wanted.version !== undefined && !versionPattern.test(wanted.version))
        throw new Error(LocateErrors.BadVersion + wanted.version)

    const name = packageName(module)
    // A builtin name the project declares, or pins, is the npm package. Otherwise it is node's,
    // from @types/node, even when a dependency hoisted a same-named polyfill into node_modules.
    const runtime = typesModule(module)
    const unpinned = wanted.version === undefined && wanted.range === undefined

    // The `bun` npm package is the binary; only resolved declarations count as its types.
    if (runtime !== undefined && (prefixed || unpinned)) {
        const types = locateIn(runtime, cwd)

        if (types?.entry === undefined) throw new Error(LocateErrors.Builtin + module)
        if (!types.onDisk) return asLocated(module, 'runtime', types)

        // node_modules/bun is the binary; the declarations are the first package after it.
        const [pkg, ...rest] = types.types

        if (pkg === undefined) throw new Error(LocateErrors.Builtin + module)
        return asLocated(module, 'runtime', {...types, pkg, types: rest})
    }

    const local = locateIn(module, cwd)
    const want = local?.onDisk === true ? await resolveVersion(name, wanted, cwd, signal) : wanted

    if (local !== undefined && matchesVersion(local, want.version))
        return asLocated(name, local.onDisk ? 'installed' : 'types-only', local)

    const root = await download(name, packTarget(name, want), cwd, signal)
    const fetched = locateDownloaded(module, root)

    if (fetched === undefined) throw new Error(`${LocateErrors.NotUnpacked}${module} in ${root}`)
    return {
        ...asLocated(name, 'downloaded', fetched),
        installed: local?.onDisk === true ? local.pkg.manifest.version : undefined
    }
}

export {
    assertPackage,
    locate,
    locateDownloaded,
    LocateErrors,
    locateIn,
    packageName,
    packages,
    projectOf,
    typesModule
}
export type {Located, Package, Project}
