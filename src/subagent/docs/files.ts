import {readdirSync, readFileSync} from 'node:fs'
import {join, relative, sep} from 'node:path'

import type {TextSource} from '../answer'
import {packages} from './locate'
import type {Located, Package} from './locate'

type CorpusFile = TextSource & {
    /** Package-qualified, so x and @types/x never clash. */
    label: string
    /** Absolute. */
    path: string
}

type Corpus = {
    files: CorpusFile[]
    declared: boolean
    /** The entry source file, when nothing declares types and it stands in for them. */
    standIn?: string
}

const isDeclaration = (name: string): boolean => /\.d\.[mc]?ts$/.test(name)
const isReadme = (name: string): boolean => name.toLowerCase().startsWith('readme')
const majorFolder = (path: string): string | undefined => /^v\d+\//.exec(path)?.[0]

// npm never packs a symlink, and a nested node_modules is another package.
const walk = (dir: string, rel = ''): string[] =>
    readdirSync(join(dir, rel), {withFileTypes: true}).flatMap(entry => {
        const path = rel === '' ? entry.name : `${rel}/${entry.name}`

        if (entry.isSymbolicLink() || entry.name === 'node_modules') return []
        if (entry.isDirectory()) return walk(dir, path)
        return entry.isFile() ? [path] : []
    })

// zod 4 ships v3/ beside v4/, and a v3 quote would pass under a zod@4 header. A package with a
// folder for its own major is read as layered; without one, vN/ folders are plain namespaces.
const packageFiles = (pkg: Package, keepFolder?: string): string[] => {
    const all = walk(pkg.dir)
    const major = pkg.manifest.version?.split('.')[0]
    const own = `v${major ?? ''}/`
    const layered = major !== undefined && all.some(path => majorFolder(path) === own)
    const keep = (folder: string | undefined): boolean =>
        !layered || folder === undefined || folder === own || folder === keepFolder
    return all
        .filter(path => keep(majorFolder(path)))
        .filter(
            path =>
                isDeclaration(path)
                || path === 'package.json'
                || (!path.includes('/') && isReadme(path))
        )
        .sort()
}

// A README line is often longer than the sentence a model copies from it.
const readFile = (pkg: Package, path: string): CorpusFile => ({
    label: `${pkg.manifest.name}/${path}`,
    path: join(pkg.dir, path),
    text: readFileSync(join(pkg.dir, path), 'utf8'),
    wholeLines: !isReadme(path)
})

// Dual ESM and CJS declarations are the same text twice and would double the corpus.
const readAll = (pkg: Package, paths: string[]): CorpusFile[] => {
    const byText = new Map<string, CorpusFile>()

    for (const path of paths) {
        const file = readFile(pkg, path)
        if (!byText.has(file.text)) byText.set(file.text, file)
    }

    return [...byText.values()]
}

// What the model is handed, and what its quotes are checked against.
const corpusOf = (located: Located): Corpus => {
    const entry = located.entry
    const entryPath =
        entry === undefined ? undefined : relative(located.pkg.dir, entry).split(sep).join('/')
    const keepFolder = entryPath === undefined ? undefined : majorFolder(entryPath)
    const files = packages(located).flatMap(pkg => readAll(pkg, packageFiles(pkg, keepFolder)))
    const declared = files.some(file => isDeclaration(file.label))

    if (declared || entryPath === undefined) return {files, declared}
    return {files: [...files, readFile(located.pkg, entryPath)], declared, standIn: entryPath}
}

export {corpusOf, packageFiles}
export type {Corpus, CorpusFile}
