import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {type Static, Type} from 'typebox'
import Value from 'typebox/value'

const deps = Type.Optional(Type.Record(Type.String(), Type.String()))
// A project root or a nested `{"type": "module"}` marker may have no name.
const manifestSchema = Type.Object({
    name: Type.Optional(Type.String()),
    /** A workspace or git package may ship none. */
    version: Type.Optional(Type.String()),
    homepage: Type.Optional(Type.String()),
    repository: Type.Optional(
        Type.Union([Type.String(), Type.Object({url: Type.Optional(Type.String())})])
    ),
    dependencies: deps,
    devDependencies: deps,
    peerDependencies: deps,
    optionalDependencies: deps
})

type Manifest = Static<typeof manifestSchema>
type Named = Manifest & {name: string}

const fields = Type.Record(Type.String(), Type.Unknown())
const promised = (key: string, value: unknown): boolean =>
    Object.hasOwn(manifestSchema.properties, key)
    && Value.Check(manifestSchema.properties[key as keyof Manifest], value)

// A field that is not what package.json promises is dropped, not trusted.
const readManifest = (dir: string): Manifest => {
    const raw = Value.Parse(fields, JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')))
    const kept = Object.entries(raw).filter(([key, value]) => promised(key, value))
    return Value.Parse(manifestSchema, Object.fromEntries(kept))
}

const isNamed = (manifest: Manifest): manifest is Named => manifest.name !== undefined

const spec = (manifest: Named): string =>
    manifest.version === undefined ? manifest.name : `${manifest.name}@${manifest.version}`

export {isNamed, readManifest, spec}
export type {Manifest, Named}
