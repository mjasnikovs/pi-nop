import type {ExtensionAPI} from '@earendil-works/pi-coding-agent'
import {Type} from 'typebox'

import {layoutPrompt, verifyAnswer} from '../answer'
import {fits} from '../budget'
import {registerSubagentTool, SubagentErrors} from '../subagent'
import {corpusOf} from './files'
import type {CorpusFile} from './files'
import {header} from './header'
import {locate, packageName, projectOf} from './locate'
import type {Located, Project} from './locate'
import {spec} from './manifest'
import {facts as registryFacts, fromRegistry} from './npm'
import type {Facts} from './npm'

enum DocsErrors {
    TooBig = 'Docs failed: package too big for the subagent model context window, even as a file list. Files: '
}

const filesPrompt = layoutPrompt({
    source: 'package files',
    subject: 'package',
    unit: 'file line',
    evidenceNotes: ['No line numbers, no file names.']
})
const toolsPrompt = [
    'Read and grep the files listed; nothing else counts, and do not answer from memory.',
    filesPrompt
].join('\n')

const render = (files: CorpusFile[]): string =>
    files.map(file => `<file path="${file.label}">\n${file.text}\n</file>`).join('\n')

// Tools mode reads the same files inline mode is handed, so a quote from anywhere else fails.
const renderPaths = (files: CorpusFile[]): string =>
    files.map(file => `<file>${file.path}</file>`).join('\n')

// For node:fs the declaration to report is @types/node's, looked up again only then.
const projectFor = (located: Located, asked: Project, cwd: string): Project =>
    located.source === 'runtime' ? projectOf(located.pkg.manifest.name, cwd) : asked

// The registry knows the package asked about, not @types/x. A runtime module is not on npm.
const factsFor = async (
    located: Located,
    project: Project,
    cwd: string,
    signal?: AbortSignal
): Promise<Facts> => {
    if (located.source === 'runtime' || !fromRegistry(project.range)) return {}
    if (located.source === 'types-only') return registryFacts(located.asked, undefined, cwd, signal)
    return registryFacts(located.pkg.manifest.name, located.pkg.manifest.version, cwd, signal)
}

export default function (pi: ExtensionAPI) {
    registerSubagentTool(pi, {
        name: 'subagent-docs',
        label: 'Subagent Docs',
        description:
            'Look up an npm package and return a focused, version-pinned answer from its type '
            + 'declarations and README, plus the latest published version. USE THIS BEFORE '
            + 'ANSWERING any question about how to use a JavaScript or TypeScript library, what '
            + 'it exports, its types, options or config, or which version to install. Do NOT '
            + 'answer package APIs from memory and do NOT run npm view or read node_modules '
            + 'yourself. Reads the installed copy when there is one, else downloads the declared '
            + 'range or the latest release. If the result says the package does not cover the '
            + 'query, report that; do not fill the gap from memory.',
        parameters: Type.Object({
            module: Type.String({
                description:
                    'Package name or subpath, as you would import it: "zod", "@scope/name", "hono/client". No version here.'
            }),
            query: Type.String({description: 'What to find out about the package.'}),
            version: Type.Optional(
                Type.String({
                    description:
                        'Exact version to read. The installed copy is used when it matches; otherwise that version is read from npm. Omit to read what is installed, or the declared range or latest when nothing is.'
                })
            )
        }),
        title: args => [args?.module, args?.query].filter(part => part !== undefined).join(' '),
        prepare: async (params, signal, configured) => {
            const model = configured.model

            if (model === undefined) throw new Error(SubagentErrors.NoModel)

            const cwd = configured.cwd
            const name = packageName(params.module)
            const asked = projectOf(name, cwd)
            const located = await locate(
                params.module,
                cwd,
                {version: params.version, range: asked.range},
                signal
            )
            const corpus = corpusOf(located)
            const ask = [
                `<query>${params.query}</query>`,
                `<module>${params.module}</module>`,
                `<package>${spec(located.pkg.manifest)}</package>`,
                ...(located.entry === undefined ? [] : [`<entry>${located.entry}</entry>`])
            ]
            const inline = [...ask, render(corpus.files)].join('\n')
            const listed = [...ask, renderPaths(corpus.files)].join('\n')
            const whole = fits(inline, model)

            if (!whole && !fits(listed, model))
                throw new Error(DocsErrors.TooBig + corpus.files.length)

            const project = projectFor(located, asked, cwd)
            const facts = await factsFor(located, project, cwd, signal)
            const lead = header(located, project, facts, corpus) + '\n'
            const verify = (text: string) => lead + verifyAnswer(text, corpus.files)

            if (whole)
                return {
                    task: inline,
                    options: {...configured, prompt: filesPrompt, tools: []},
                    verify
                }
            return {task: listed, options: {...configured, prompt: toolsPrompt}, verify}
        }
    })
}
