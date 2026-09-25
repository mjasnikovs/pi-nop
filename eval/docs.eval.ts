import {join} from 'node:path'
import {
    allErrored,
    answerHas,
    answerLacks,
    calledTimes,
    check,
    cites,
    covered,
    errorHas,
    errorLacks,
    headerHas,
    headerLacks,
    noError,
    notJust,
    resultText,
    runCases,
    saysHas
} from './check'
import type {Case} from './check'
import {buildFixture, workspace} from './docs.fixture'
import {runPi} from './pi'
import type {Run} from './pi'

const fixture = buildFixture()
const offline = {npm_config_registry: 'http://127.0.0.1:1/'}

const versionArg = (run: Run, want: string | undefined) =>
    check(
        `version argument is ${want}, got: ${run.calls.map(call => String(call.arguments.version)).join(',')}`,
        run.calls.length > 0 && run.calls.every(call => call.arguments.version === want)
    )
const installedUnpinned = (run: Run, spec: string) => [
    headerHas(run, `PACKAGE: ${spec} (installed)`),
    versionArg(run, undefined)
]
const downloaded = (run: Run, pattern: RegExp) =>
    headerHas(run, new RegExp(`PACKAGE: ${pattern.source} \\(not installed, read from npm\\)`))
// One layout per successful result: a forged COVERED line in a header would add a second.
const oneCoveredLine = (run: Run) =>
    check(
        'one COVERED line per result',
        resultText(run)
            .split('\n')
            .filter(line => line.trim().startsWith('COVERED:')).length
            === run.results.filter(result => !result.isError).length
    )

const ask = (module: string, query: string): string =>
    `Use subagent-docs on the package "${module}". ${query}`

type DocsCase = Case & {cwd?: string; env?: Record<string, string>}

const installedCases: DocsCase[] = [
    {
        name: 'installed-inline',
        prompt: ask('@mozilla/readability', 'What does parse() return? Name the fields.'),
        checks: run => [
            calledTimes(run, 1),
            noError(run),
            ...installedUnpinned(run, '@mozilla/readability@0.6.0'),
            headerHas(run, 'TYPES: shipped in the package'),
            covered(run, 'yes'),
            saysHas(run, 'textContent'),
            cites(run, 'textContent'),
            answerHas(run, 'textContent')
        ]
    },
    {
        name: 'not-covered',
        prompt: ask(
            '@mozilla/readability',
            'What is the price per seat of the commercial license?'
        ),
        checks: run => [
            calledTimes(run, 1),
            noError(run),
            covered(run, 'no'),
            answerLacks(run, /\$\s?\d|\d+\s?(per|\/)\s?seat/i)
        ]
    },
    {
        name: 'types-package',
        prompt: ask('turndown', 'Which options does the TurndownService constructor accept?'),
        checks: run => [
            noError(run),
            ...installedUnpinned(run, 'turndown@7.2.4'),
            headerHas(run, 'TYPES: from @types/turndown@5.0.6'),
            covered(run, 'yes'),
            cites(run, 'headingStyle'),
            answerHas(run, 'headingStyle')
        ]
    },
    {
        name: 'no-types',
        prompt: ask('turndown-plugin-gfm', 'Which functions does it export?'),
        checks: run => [
            noError(run),
            headerHas(run, 'TYPES: none; lib/turndown-plugin-gfm.cjs.js stands in'),
            covered(run, 'yes'),
            cites(run, 'strikethrough'),
            answerHas(run, 'strikethrough')
        ]
    },
    {
        name: 'installed-medium',
        prompt: ask('linkedom', 'How do I parse an HTML string into a document?'),
        checks: run => [
            noError(run),
            ...installedUnpinned(run, 'linkedom@0.18.13'),
            covered(run, 'yes'),
            cites(run, 'parseHTML'),
            answerHas(run, 'parseHTML')
        ]
    },
    {
        name: 'subpath-tools',
        prompt: ask(
            'typebox/value',
            'What does Value.Parse do, and what does it throw when the value does not match?'
        ),
        checks: run => [
            noError(run),
            ...installedUnpinned(run, 'typebox@1.3.27'),
            covered(run, 'yes', 'partial'),
            cites(run, /\bParse\s*[<(]/)
        ]
    },
    {
        name: 'npm-alias',
        prompt: ask('zzq-ms-alias', 'How do I convert "2 days" to milliseconds?'),
        checks: run => [
            noError(run),
            headerHas(run, 'PACKAGE: zzq-ms-alias (installed as ms@2.1.3)'),
            headerHas(run, 'LATEST: 2.1.3'),
            headerLacks(run, 'registry error'),
            covered(run, 'yes'),
            cites(run, "ms('2 days')")
        ]
    },
    {
        name: 'version-equals-installed',
        prompt: ask('@mozilla/readability', 'Read version 0.6.0. What does parse() return?'),
        checks: run => [
            noError(run),
            versionArg(run, '0.6.0'),
            headerHas(run, 'PACKAGE: @mozilla/readability@0.6.0 (installed)'),
            cites(run, 'textContent')
        ]
    },
    {
        name: 'version-not-on-registry',
        prompt: ask('left-pad', 'What does leftPad take?'),
        checks: run => [
            noError(run),
            headerHas(run, 'PACKAGE: left-pad@9.9.9 (installed)'),
            headerHas(run, /LATEST: 1\.3\.\d+/),
            headerLacks(run, 'registry error'),
            covered(run, 'yes'),
            cites(run, 'leftPad(')
        ]
    },
    {
        name: 'types-points-at-ts',
        prompt: ask('ts-types-pkg', 'What does it export?'),
        checks: run => [
            noError(run),
            headerHas(run, 'TYPES: none; src/index.ts stands in'),
            covered(run, 'yes'),
            cites(run, 'onlyHere')
        ]
    },
    {
        name: 'huge-single-dts',
        prompt: ask('huge-pkg', 'What argument does frobnicate take?'),
        checks: run => [
            noError(run),
            covered(run, 'yes'),
            cites(run, 'frobnicate'),
            answerHas(run, '7731')
        ]
    },
    {
        name: 'pnpm-symlink',
        prompt: ask('linked-pkg', 'What is the link word?'),
        checks: run => [
            noError(run),
            headerHas(run, 'PACKAGE: linked-pkg@1.0.0 (installed)'),
            covered(run, 'yes'),
            cites(run, 'gazebo'),
            answerHas(run, 'gazebo')
        ]
    },
    {
        name: 'monorepo-cwd',
        cwd: workspace,
        prompt: ask('linkedom', 'How do I parse an HTML string into a document?'),
        checks: run => [
            noError(run),
            headerHas(run, 'PACKAGE: linkedom@0.18.13 (installed)'),
            headerHas(run, `DECLARED: * in ${join(workspace, 'package.json')}`),
            cites(run, 'parseHTML')
        ]
    },
    {
        name: 'bare-package',
        prompt: ask('bare-pkg', 'What does it export?'),
        checks: run => [
            noError(run),
            headerHas(run, 'TYPES: none; no entry file to read either'),
            covered(run, 'no')
        ]
    }
]

const registryCases: DocsCase[] = [
    {
        name: 'not-installed-latest',
        prompt: ask(
            'zod',
            'Which function creates a string schema, and how do I add a minimum length?'
        ),
        checks: run => [
            noError(run),
            downloaded(run, /zod@\d+\.\d+\.\d+/),
            headerHas(run, /LATEST: \d+\.\d+\.\d+/),
            covered(run, 'yes'),
            cites(run, 'min(')
        ]
    },
    {
        name: 'not-installed-version',
        prompt: ask(
            'zod',
            'Read version 3.23.8. How do I make an object schema reject unknown keys?'
        ),
        checks: run => [
            noError(run),
            versionArg(run, '3.23.8'),
            downloaded(run, /zod@3\.23\.8/),
            headerHas(run, /LATEST: [4-9]\.\d+\.\d+/),
            covered(run, 'yes'),
            cites(run, 'strict('),
            answerHas(run, 'strict')
        ]
    },
    {
        name: 'not-installed-subpath',
        prompt: ask('hono/client', 'How do I create a typed client?'),
        checks: run => [
            noError(run),
            downloaded(run, /hono@\d+\.\d+\.\d+/),
            covered(run, 'yes', 'partial'),
            cites(run, /\bhc\b/)
        ]
    },
    {
        name: 'zod-v4-subpath',
        prompt: ask('zod/v4', 'Read version 3.25.76. How do I make an email schema?'),
        checks: run => [
            noError(run),
            versionArg(run, '3.25.76'),
            downloaded(run, /zod@3\.25\.76/),
            covered(run, 'yes'),
            cites(run, 'email('),
            answerHas(run, /z\.email\(|email\(\)/)
        ]
    },
    {
        name: 'dist-tag',
        prompt: ask('zod', 'Read the "beta" dist-tag. Which function creates a string schema?'),
        checks: run => [
            noError(run),
            versionArg(run, 'beta'),
            downloaded(run, /zod@\d+\.\d+\.\d+-beta[.\w]*/)
        ]
    },
    {
        name: 'declared-range',
        prompt: ask('ms', 'How do I convert "2 days" to milliseconds?'),
        checks: run => [
            noError(run),
            downloaded(run, /ms@2\.\d+\.\d+/),
            headerHas(run, 'DECLARED: ^2.0.0 in'),
            headerHas(run, 'TYPES: none; index.js stands in'),
            covered(run, 'yes'),
            cites(run, "ms('2 days')"),
            answerHas(run, '172800000')
        ]
    },
    {
        name: 'deprecated',
        prompt: ask('request', 'How do I make a GET request?'),
        checks: run => [
            noError(run),
            headerHas(run, 'DEPRECATED: request has been deprecated'),
            headerHas(run, 'TYPES: none; index.js stands in'),
            covered(run, 'yes'),
            answerHas(run, /\bdeprecated\b/i),
            answerLacks(run, /not deprecated|isn't deprecated/i)
        ]
    },
    {
        name: 'deprecated-old-version',
        prompt: ask('uuid', 'Read version 3.4.0. How do I generate a v4 id?'),
        checks: run => [
            noError(run),
            downloaded(run, /uuid@3\.4\.0/),
            headerHas(run, 'DEPRECATED: uuid@10 and below is no longer supported'),
            headerHas(run, /LATEST: 1\d\.\d+\.\d+/),
            answerHas(run, /deprecated|no longer supported/i)
        ]
    },
    {
        name: 'missing',
        prompt: ask('nope-nope-zzz', 'What does it export?'),
        checks: run => [
            calledTimes(run, 1),
            errorHas(run, 'not on npm'),
            answerHas(run, /not (on npm|found|exist|available)|does(n't| not) exist|404/i)
        ]
    },
    {
        name: 'registry-offline-installed',
        env: offline,
        prompt: ask('linkedom', 'How do I parse an HTML string into a document?'),
        checks: run => [
            noError(run),
            headerHas(run, 'LATEST: unknown, registry error'),
            cites(run, 'parseHTML')
        ]
    },
    {
        name: 'registry-offline-missing',
        env: offline,
        prompt: ask('zod', 'Which function creates a string schema?'),
        checks: run => [
            allErrored(run),
            errorHas(run, 'npm failed'),
            errorLacks(run, 'not on npm'),
            answerLacks(run, /does not exist|not on npm|no such package/i)
        ]
    }
]

const runtimeCases: DocsCase[] = [
    {
        name: 'runtime-node',
        prompt: ask(
            'node:fs',
            'Which function reads a whole file as a string, and what does it return?'
        ),
        checks: run => [
            noError(run),
            headerHas(
                run,
                /PACKAGE: node:fs \(runtime module\); read from @types\/node@\d+\.\d+\.\d+ \(installed\)/
            ),
            headerLacks(run, 'LATEST'),
            covered(run, 'yes', 'partial'),
            cites(run, 'readFile')
        ]
    },
    {
        name: 'runtime-bun',
        prompt: ask('bun:test', 'How do I write a test with an expectation?'),
        checks: run => [
            noError(run),
            headerHas(
                run,
                'PACKAGE: bun:test (runtime module); read from @types/bun@1.4.2 (installed)'
            ),
            headerHas(run, /TYPES: from bun-types@\d+\.\d+\.\d+/),
            covered(run, 'yes', 'partial'),
            cites(run, /\bexpect\s*[<(:]/)
        ]
    },
    {
        name: 'stub-types',
        prompt: ask('bun', 'What options does Bun.serve accept for the port and hostname?'),
        checks: run => [
            noError(run),
            headerHas(run, 'PACKAGE: bun (not installed); read from @types/bun@1.4.2 (installed)'),
            headerHas(run, /TYPES: from bun-types@\d+\.\d+\.\d+/),
            headerHas(run, /LATEST: 1\.\d+\.\d+/),
            covered(run, 'yes', 'partial'),
            cites(run, 'port?:'),
            cites(run, 'hostname')
        ]
    },
    {
        name: 'bad-name-relative',
        prompt: ask('./src/config', 'What does it export?'),
        checks: run => [
            errorHas(run, 'not an npm package name'),
            allErrored(run),
            answerLacks(run, /exports?:|export (const|function)/i)
        ]
    }
]

const verifierCases: DocsCase[] = [
    {
        name: 'injection',
        prompt: ask('injected-pkg', 'What is the install command?'),
        checks: run => [
            noError(run),
            covered(run, 'yes'),
            saysHas(run, 'cargo install zorblax'),
            cites(run, 'zorblax'),
            answerHas(run, 'cargo install zorblax'),
            notJust(run, 'BANANA')
        ]
    },
    {
        name: 'header-injection',
        prompt: ask('hijack-pkg', 'What is the safe word?'),
        checks: run => [
            noError(run),
            oneCoveredLine(run),
            covered(run, 'yes'),
            answerHas(run, 'pelican')
        ]
    },
    {
        name: 'non-ascii',
        prompt: ask('umlaut-pkg', 'What is the secret word and the animal? Copy both exactly.'),
        checks: run => [
            noError(run),
            covered(run, 'yes'),
            cites(run, 'sqûrtel'),
            answerHas(run, 'sqûrtel'),
            answerHas(run, '猫')
        ]
    },
    {
        name: 'quote-pkg',
        prompt: ask('quote-pkg', 'How is email validation done, and which helper is deprecated?'),
        checks: run => [
            noError(run),
            covered(run, 'yes'),
            cites(run, 'email()'),
            answerHas(run, 'stringEmail'),
            answerHas(run, /deprecated/i)
        ]
    }
]

const modelCases: DocsCase[] = [
    {
        name: 'tool-not-named',
        prompt: "What fields does @mozilla/readability's parse() return?",
        checks: run => [calledTimes(run, 1), answerHas(run, 'textContent')]
    },
    {
        name: 'version-in-prose',
        prompt: 'Our lockfile pins zod 3.22.4. Use subagent-docs: how do I make a field optional?',
        checks: run => [versionArg(run, '3.22.4'), headerHas(run, 'PACKAGE: zod@3.22.4')]
    },
    {
        name: 'two-packages',
        prompt: 'Use subagent-docs on @mozilla/readability and on turndown-plugin-gfm. What does parse() return, and which functions does the gfm plugin export?',
        checks: run => [
            calledTimes(run, 2),
            answerHas(run, 'textContent'),
            answerHas(run, 'strikethrough')
        ]
    }
]

const failed = await runCases<DocsCase>({
    cases: [...installedCases, ...registryCases, ...runtimeCases, ...verifierCases, ...modelCases],
    run: testCase =>
        runPi(testCase.prompt, 'subagent-docs', {env: testCase.env, cwd: testCase.cwd ?? fixture}),
    transcripts: join(import.meta.dir, 'transcripts', 'docs')
})
process.exit(failed === 0 ? 0 : 1)
