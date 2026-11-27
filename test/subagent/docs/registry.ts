import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

import {tar} from '../../../src/subagent/docs/tar'
import {tempTree} from '../../tree'
import type {Files} from '../../tree'

type Version = {name: string; version: string}
type Packument = {
    name: string
    'dist-tags': Record<string, string>
    versions: Record<string, Version>
}

const packument = (name: string, latest: string, versions: Record<string, object>): Packument => ({
    name,
    'dist-tags': {latest, beta: '9.0.0-beta.1'},
    versions: Object.fromEntries(
        Object.entries(versions).map(([version, extra]) => [version, {name, version, ...extra}])
    )
})

const tarball = (files: Files): Uint8Array => {
    const root = tempTree(
        Object.fromEntries(Object.entries(files).map(([path, text]) => [`package/${path}`, text]))
    )
    execFileSync(tar, ['-czf', 'pkg.tgz', 'package'], {cwd: root})
    return readFileSync(join(root, 'pkg.tgz'))
}

const tarballPath = (name: string, version: string): string => `/-/${name}-${version}.tgz`

// The tarball URL needs the port, so it is written into the packument per request.
const withTarballs = (doc: Packument, origin: string, tarballs: Record<string, Uint8Array>) => ({
    ...doc,
    versions: Object.fromEntries(
        Object.entries(doc.versions).map(([version, meta]) => {
            const path = tarballPath(meta.name, version)
            const dist = path in tarballs ? {tarball: origin + path} : undefined
            return [version, {...meta, dist}]
        })
    )
})

// A registry of our own, serving packuments the way npm view reads them and tarballs to npm pack.
const serveRegistry = (
    docs: Record<string, Packument>,
    tarballs: Record<string, Uint8Array> = {},
    onHit?: () => void
) =>
    Bun.serve({
        port: 0,
        fetch: request => {
            onHit?.()
            const url = new URL(request.url)
            const file = tarballs[url.pathname]

            if (file !== undefined) return new Response(file)

            const doc = docs[url.pathname]

            if (doc === undefined) return new Response('missing', {status: 404})
            return Response.json(withTarballs(doc, url.origin, tarballs))
        }
    })

export {packument, serveRegistry, tarball, tarballPath}
export type {Packument}
