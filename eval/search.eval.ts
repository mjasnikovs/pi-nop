import {join} from 'node:path'
import {engines} from '../src/config/config'
import type {EngineName} from '../src/config/config'
import {braveKey} from '../src/search/brave'
import {endpointOverride} from '../src/search/engines'
import {engineOverride} from '../src/search/search'
import {check, errorHas, noError, resultText, runCases} from './check'
import type {Case} from './check'
import {port, searchKey, serveFixtures} from './fixtures'
import {runPi} from './pi'
import type {Run} from './pi'

const server = serveFixtures()
const base = `http://127.0.0.1:${server.port}`
const url = (path: string): string => base + path
const transcripts = join(import.meta.dir, 'transcripts', 'search')
const searched = (run: Run, times: number) =>
    check(
        `web-search called ${times}x, got ${run.calls.length}`,
        run.calls.filter(call => call.name === 'web-search').length === times
    )
const fetched = (run: Run, exact: string) =>
    check(
        `subagent-fetch called with ${exact}`,
        run.calls.some(call => call.name === 'subagent-fetch' && call.arguments.url === exact)
    )
const listed = (run: Run, needle: string) =>
    check(`result lists "${needle}", got: ${resultText(run)}`, resultText(run).includes(needle))
const notListed = (run: Run, needle: string) =>
    check(`result must not list "${needle}"`, !resultText(run).includes(needle))
const answerHas = (run: Run, needle: string) =>
    check(`answer holds "${needle}", got: ${run.answer}`, run.answer.includes(needle))

type SearchCase = Case & {tools?: string}

const ask = (query: string, then: string): string =>
    `Use web-search with the query "${query}". ${then}`

const commonCases: SearchCase[] = [
    {
        name: 'lists-results',
        prompt: ask(
            'zorblax cli',
            'Reply with the URL of the Zorblax CLI result and nothing else.'
        ),
        checks: run => [
            noError(run),
            searched(run, 1),
            listed(run, `[Zorblax CLI](${url('/tool')})`),
            listed(run, 'Install and run the Zorblax CLI.'),
            answerHas(run, url('/tool'))
        ]
    },
    {
        name: 'search-then-fetch',
        tools: 'web-search,subagent-fetch',
        prompt:
            'What is the default port of the Zorblax CLI? Use web-search to find its page, '
            + 'then subagent-fetch on the best result. Reply with the number only.',
        checks: run => [
            noError(run),
            searched(run, 1),
            fetched(run, url('/tool')),
            answerHas(run, port)
        ]
    },
    {
        name: 'no-results',
        prompt: ask('nothing at all', 'Tell me what it returned.'),
        checks: run => [
            noError(run),
            searched(run, 1),
            listed(run, 'No results for: nothing at all'),
            check('answer says no results', /no results/i.test(run.answer))
        ]
    },
    {
        name: 'bad-url-dropped',
        prompt: ask('bad url', 'Reply with every URL it returned.'),
        checks: run => [
            noError(run),
            listed(run, url('/tool')),
            notListed(run, 'ftp://'),
            check('answer has no ftp url', !run.answer.includes('ftp://'))
        ]
    }
]

const engineCases: Record<EngineName, SearchCase[]> = {
    exa: [
        {
            name: 'rpc-error',
            prompt: ask('rpc error', 'Tell me what happened.'),
            checks: run => [errorHas(run, 'Search failed: exa: quota exceeded'), searched(run, 1)]
        }
    ],
    brave: [
        {
            name: 'bad-key',
            prompt: ask('zorblax cli', 'Tell me what happened.'),
            checks: run => [
                errorHas(run, 'Search failed: brave 401 Unauthorized'),
                searched(run, 1)
            ]
        }
    ],
    ddg: [
        {
            name: 'challenge',
            prompt: ask('challenge me', 'Tell me what happened.'),
            checks: run => [errorHas(run, 'bot challenge'), searched(run, 1)]
        }
    ]
}

const envFor = (engine: EngineName, name: string): Record<string, string> => ({
    [engineOverride]: engine,
    [endpointOverride]: url(`/${engine}`),
    [braveKey]: name === 'bad-key' ? 'wrong' : searchKey
})

let failed = 0

for (const engine of engines)
    failed += await runCases<SearchCase>({
        cases: [...commonCases, ...engineCases[engine]],
        run: testCase =>
            runPi(testCase.prompt, testCase.tools ?? 'web-search', {
                env: envFor(engine, testCase.name)
            }),
        transcripts,
        label: testCase => `${engine}-${testCase.name}`
    })

await server.stop()
process.exit(failed === 0 ? 0 : 1)
