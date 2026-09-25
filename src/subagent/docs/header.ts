import type {Corpus} from './files'
import type {Located, Project} from './locate'
import {spec} from './manifest'
import type {Manifest} from './manifest'
import type {Facts} from './npm'

// A manifest field or a deprecation notice could carry a fake "COVERED:" line.
const headerLine = (label: string, value: string | undefined): string[] =>
    value === undefined ? [] : [`${label}: ${value.replace(/\s+/g, ' ').trim()}`]

const packageLine = (located: Located): string => {
    const read = spec(located.pkg.manifest)

    switch (located.source) {
        case 'downloaded':
            if (located.installed === undefined) return `${read} (not installed, read from npm)`
            return `${read} (read from npm; installed is ${located.pkg.manifest.name}@${located.installed})`
        case 'types-only':
            return `${located.asked} (not installed); read from ${read} (installed)`
        case 'runtime':
            return `${located.asked} (runtime module); read from ${read} (installed)`
        case 'installed':
            if (located.asked === located.pkg.manifest.name) return `${read} (installed)`
            return `${located.asked} (installed as ${read})`
    }
}

const typesLine = (located: Located, corpus: Corpus): string => {
    if (located.types.length > 0)
        return `from ${located.types.map(pkg => spec(pkg.manifest)).join(', ')}`
    if (corpus.declared) return 'shipped in the package'
    if (corpus.standIn === undefined) return 'none; no entry file to read either'
    return `none; ${corpus.standIn} stands in`
}

const declaredLine = (project: Project): string | undefined => {
    if (project.path === undefined) return undefined
    if (project.range === undefined) return `no, not in ${project.path}`
    return `${project.range} in ${project.path}`
}

const latestLine = (facts: Facts): string | undefined =>
    facts.error === undefined ? facts.latest : `unknown, registry error: ${facts.error}`

const repositoryUrl = (manifest: Manifest): string | undefined =>
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url

// Every line is copied from package.json or the registry. The subagent never sees it.
const header = (located: Located, project: Project, facts: Facts, corpus: Corpus): string =>
    [
        ...headerLine('PACKAGE', packageLine(located)),
        ...headerLine('DECLARED', declaredLine(project)),
        ...headerLine('LATEST', latestLine(facts)),
        ...headerLine('DEPRECATED', facts.deprecated),
        ...headerLine('TYPES', typesLine(located, corpus)),
        ...headerLine('HOMEPAGE', located.pkg.manifest.homepage),
        ...headerLine('REPOSITORY', repositoryUrl(located.pkg.manifest))
    ].join('\n')

export {header}
