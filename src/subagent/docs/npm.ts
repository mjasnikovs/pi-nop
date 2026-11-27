import {existsSync, mkdirSync, mkdtempSync, renameSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {getAgentDir} from '@earendil-works/pi-coding-agent'
import {Type} from 'typebox'
import Value from 'typebox/value'
import spawn from 'cross-spawn'

import {describe} from '../describe'
import {unlessAborted} from '../subagent'
import {readManifest} from './manifest'
import {childEnv, missing, onPath, stop, tar} from './platform'

// Not execFile: it cannot start Windows' npm.cmd. cross-spawn escapes each argument for cmd.exe.
const run = (
    command: string,
    args: string[],
    cwd?: string,
    signal?: AbortSignal
): Promise<string> =>
    new Promise<string>((resolve, reject) => {
        signal?.throwIfAborted()
        const child = spawn(onPath(command), args, {
            cwd,
            env: childEnv(),
            stdio: ['ignore', 'pipe', 'pipe']
        })
        const abort = () => stop(child)
        let stdout = ''
        let stderr = ''
        const settle = () => signal?.removeEventListener('abort', abort)
        signal?.addEventListener('abort', abort, {once: true})
        child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
        child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
        // A failed spawn still ends in close, so settle there covers it.
        child.on('error', reject)
        child.on('close', (code, killedBy) => {
            settle()
            if (code === 0) return resolve(stdout)
            reject(
                new Error(stderr || stdout || `${command} ended with ${String(killedBy ?? code)}`)
            )
        })
    }).catch((error: unknown) => {
        throw missing(command, error)
    })

enum NpmErrors {
    Missing = 'not on npm: ',
    Failed = 'npm failed: ',
    Unservable = 'Docs failed: not installed, and declared from outside the registry: '
}

type Wanted = {
    version?: string
    range?: string
}

type Target = {
    /** The registry package: the alias target under an npm: range. */
    name: string
    spec: string
}

type View = {
    version: string
    deprecated?: string
    latest: string
}

// npm's codes for "no such package or version". Anything else is npm or the network failing.
const missingCodes = ['E404', 'ETARGET', 'EINVALIDTAGNAME', 'EINVALIDPACKAGENAME']

// npm 10 prints `npm error code X`, npm 9 `npm ERR! code X`. A silent npm prints only its --json error.
const npmCode = (error: unknown): string => {
    const text = describe(error)
    const found = /^npm (?:error|ERR!) code (\S+)|"code": "([^"]+)"/m.exec(text)
    return found?.[1] ?? found?.[2] ?? text
}

// npm runs in the project, so .npmrc scopes, mirrors and auth hold, the same as an install would.
const npm = async (
    target: Target,
    args: string[],
    cwd: string,
    signal?: AbortSignal
): Promise<string> =>
    run('npm', args, cwd, signal).catch((error: unknown) => {
        unlessAborted(signal, error)
        const code = npmCode(error)
        const lead = missingCodes.includes(code) ? NpmErrors.Missing : NpmErrors.Failed
        throw new Error(`${lead}${target.name}@${target.spec} (${code})`, {cause: error})
    })

const viewed = Type.Object({
    version: Type.String(),
    deprecated: Type.Optional(Type.String()),
    'dist-tags.latest': Type.String()
})
const viewedShape = Type.Union([viewed, Type.Array(viewed)])

// `name` and `version` always exist, so the answer is an object, or an array of them for a range.
const view = async (target: Target, cwd: string, signal?: AbortSignal): Promise<View> => {
    const fields = ['name', 'version', 'deprecated', 'dist-tags.latest']
    const stdout = await npm(
        target,
        ['view', '--json', '--', `${target.name}@${target.spec}`, ...fields],
        cwd,
        signal
    )
    // npm prints nothing, with exit 0, for a tag the package does not have.
    const parsed = stdout.trim() === '' ? [] : Value.Parse(viewedShape, JSON.parse(stdout))
    const last = Array.isArray(parsed) ? parsed.at(-1) : parsed

    if (last === undefined)
        throw new Error(`${NpmErrors.Missing}${target.name}@${target.spec} (empty)`)
    return {version: last.version, deprecated: last.deprecated, latest: last['dist-tags.latest']}
}

type Facts = {
    latest?: string
    deprecated?: string
    error?: string
}

// Our own errors carry npm's whole stderr as `cause`; the header wants the one-line message.
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const isMissing = (error: unknown): boolean => message(error).startsWith(NpmErrors.Missing)

// The registry view of one package: latest, and the deprecation of the version in hand. A
// version the registry never saw (a git install) is simply not deprecated.
const facts = async (
    name: string,
    version: string | undefined,
    cwd: string,
    signal?: AbortSignal
): Promise<Facts> => {
    try {
        const seen = await view({name, spec: version ?? 'latest'}, cwd, signal)
        return {latest: seen.latest, deprecated: seen.deprecated}
    } catch (error) {
        if (signal?.aborted) throw error
        if (version === undefined || !isMissing(error)) return {error: message(error)}
        return facts(name, undefined, cwd, signal)
    }
}

const cacheDir = (): string => join(getAgentDir(), 'cache', 'pi-nop-docs')

// An alias tree is keyed by both names, so real foo@1 and foo aliasing bar@1 never share a folder.
const cacheRoot = (asked: string, name: string, version: string): string => {
    const label = asked === name ? `${asked}@${version}` : `${asked}=${name}@${version}`
    return join(cacheDir(), label.replaceAll('/', '+'))
}

// Two callers may finish the same unpack together; the tree already there is as good as ours.
const moveIntoCache = (tree: string, root: string): void => {
    try {
        renameSync(tree, root)
    } catch (error) {
        if (!existsSync(root)) throw error
    }
}

const unpack = async (
    asked: string,
    target: Target,
    scratch: string,
    cwd: string,
    signal?: AbortSignal
): Promise<string> => {
    const stdout = await npm(
        target,
        [
            'pack',
            '--ignore-scripts',
            '--pack-destination',
            scratch,
            '--',
            `${target.name}@${target.spec}`
        ],
        cwd,
        signal
    )
    const tarball = join(scratch, stdout.trim().split('\n').at(-1) ?? '')
    const dir = join(scratch, 'tree', 'node_modules', asked)
    mkdirSync(dir, {recursive: true})
    await run(tar, ['-xzf', tarball, '-C', dir, '--strip-components=1'], undefined, signal).catch(
        (error: unknown) => {
            unlessAborted(signal, error)
            throw error
        }
    )
    return join(scratch, 'tree')
}

const exactVersion = /^\d+\.\d+\.\d+(-[\w.-]+)?$/

// A tag names one version, so it is looked up and can hit the cache. A range is left to
// `npm pack`, which picks the highest match the way an install would; `npm view` lists in
// publish order.
const isRange = (spec: string): boolean =>
    !exactVersion.test(spec) && /^[\d^~<>=*]|[\s|]/.test(spec)

// The scratch folder goes whatever happens, so a lost rename or a failure leaves nothing behind.
const unpackIntoCache = async (
    asked: string,
    target: Target,
    cwd: string,
    signal?: AbortSignal
): Promise<string> => {
    mkdirSync(cacheDir(), {recursive: true})
    const scratch = mkdtempSync(join(cacheDir(), 'pack-'))

    try {
        const tree = await unpack(asked, target, scratch, cwd, signal)
        const version = readManifest(join(tree, 'node_modules', asked)).version ?? target.spec
        const root = cacheRoot(asked, target.name, version)
        moveIntoCache(tree, root)
        return root
    } finally {
        rmSync(scratch, {recursive: true, force: true})
    }
}

const download = async (
    asked: string,
    target: Target,
    cwd: string,
    signal?: AbortSignal
): Promise<string> => {
    if (exactVersion.test(target.spec)) {
        const known = cacheRoot(asked, target.name, target.spec)
        return existsSync(known) ? known : unpackIntoCache(asked, target, cwd, signal)
    }

    if (isRange(target.spec)) return unpackIntoCache(asked, target, cwd, signal)

    const {version} = await view(target, cwd, signal)
    return download(asked, {name: target.name, spec: version}, cwd, signal)
}

// A version from the model is an exact version or a dist-tag, never a path, URL or protocol.
const versionPattern = /^[\w.-]+$/

// "latest" or a tag is the registry's word for a version; the installed copy may be it.
const resolveVersion = async (
    asked: string,
    wanted: Wanted,
    cwd: string,
    signal?: AbortSignal
): Promise<Wanted> => {
    if (
        wanted.version === undefined
        || exactVersion.test(wanted.version)
        || isRange(wanted.version)
    )
        return wanted
    return {...wanted, version: (await view(packTarget(asked, wanted), cwd, signal)).version}
}

// A workspace:, file: or git range names something the registry does not have, and a
// same-named stranger there would be the wrong answer. An npm: range names the real package.
const fromRegistry = (range: string | undefined): boolean =>
    range === undefined || range.startsWith('npm:') || !/[:/]/.test(range)

const packTarget = (asked: string, wanted: Wanted): Target => {
    if (!fromRegistry(wanted.range))
        throw new Error(`${NpmErrors.Unservable}${asked} (${wanted.range})`)

    const alias = /^npm:(.+?)(?:@([^@]+))?$/.exec(wanted.range ?? '')
    const name = alias?.[1] ?? asked
    const range = alias === null ? wanted.range : alias[2]

    if (wanted.version !== undefined) return {name, spec: wanted.version}
    return {name, spec: range ?? 'latest'}
}

export {download, facts, fromRegistry, packTarget, resolveVersion, versionPattern, view}
export type {Facts, Wanted}
