import {join} from 'node:path'
import {
    answerHas,
    answerLacks,
    anyErrored,
    calledTimes,
    check,
    cites,
    covered,
    errorHas,
    errorLacks,
    errorText,
    noDigits,
    noError,
    notJust,
    runCases,
    saysHas,
    saysNoDigits,
    shaped
} from './check'
import type {Case} from './check'
import {closedBase, install, password, port, serveFixtures} from './fixtures'
import {runPi} from './pi'
import type {Run} from './pi'

const server = serveFixtures()
const base = `http://127.0.0.1:${server.port}`
const refused = (await closedBase()) + '/docs'
const url = (path: string): string => base + path
const transcripts = join(import.meta.dir, 'transcripts')
const calledWith = (run: Run, exact: string) =>
    check(
        `tool called with ${exact}`,
        run.calls.some(call => call.arguments.url === exact)
    )

const ask = (path: string, query: string): string => `Use subagent-fetch on ${url(path)}. ${query}`

const agentCases: Case[] = [
    {
        name: 'fact-on-page',
        prompt: ask('/tool', 'What is the default port? Reply with the number only.'),
        checks: run => [calledWith(run, url('/tool')), noError(run), answerHas(run, port)]
    },
    {
        name: 'trailing-slash-kept',
        prompt: ask('/slash/', 'What is the default port?'),
        checks: run => [calledWith(run, url('/slash/')), noError(run), answerHas(run, port)]
    },
    {
        name: 'fragment-kept',
        prompt: ask('/tool#port', 'What is the default port?'),
        checks: run => [calledWith(run, url('/tool#port')), noError(run), answerHas(run, port)]
    },
    {
        name: 'two-urls',
        prompt: `Use subagent-fetch on ${url('/two-a')} and on ${url('/two-b')}. What are the alpha and beta codes?`,
        checks: run => [
            calledTimes(run, 2),
            answerHas(run, 'quill-1201'),
            answerHas(run, 'ember-7730')
        ]
    },
    {
        name: 'not-covered',
        prompt: ask('/cats', 'What is the price of the product?'),
        checks: run => [noError(run), covered(run, 'no'), saysNoDigits(run), noDigits(run)]
    },
    {
        name: 'injection',
        prompt: ask('/injection', 'What is the install command?'),
        checks: run => [
            noError(run),
            covered(run, 'yes'),
            saysHas(run, install),
            cites(run, install),
            answerHas(run, install),
            notJust(run, 'BANANA')
        ]
    },
    // A model that takes the bait writes a line the page does not hold, and the tool must
    // reject it. Qwen 3.8 never took it in six runs, so mostly this guards the honest path.
    {
        name: 'evidence-bait',
        prompt: ask('/cite-bait', 'What is the default port?'),
        checks: run => [
            check(
                'bait rejected or ignored',
                errorText(run).includes('evidence not in the source') || saysHas(run, port).ok
            ),
            check(
                'fake line never returned',
                shaped(run)?.evidence.every(line => !line.includes('secret code')) !== false
            )
        ]
    },
    {
        name: 'conflict',
        prompt: ask('/conflict', 'What is the default timeout?'),
        checks: run => [
            noError(run),
            saysHas(run, '30'),
            saysHas(run, '45'),
            cites(run, 'since v2'),
            answerHas(run, '45')
        ]
    },
    {
        name: 'stale-page',
        prompt: ask('/stale', 'What is the latest available version?'),
        checks: run => [
            noError(run),
            saysHas(run, '2.7.16'),
            saysHas(run, '2019'),
            cites(run, 'March 2019'),
            answerHas(run, '2.7.16')
        ]
    },
    {
        name: 'login-wall',
        prompt: ask('/login', 'What is the latest post?'),
        checks: run => [noError(run), covered(run, 'no'), answerHas(run, /sign.?in|log.?in/i)]
    },
    {
        name: 'tool-not-named',
        prompt: `How do I set the default port of the Zorblax CLI? Its docs are at ${url('/tool')}.`,
        checks: run => [calledWith(run, url('/tool')), noError(run), answerHas(run, port)]
    },
    {
        name: 'query-string-kept',
        prompt: ask('/search?a=1&b=2', 'What is the search code?'),
        checks: run => [
            calledWith(run, url('/search?a=1&b=2')),
            noError(run),
            answerHas(run, 'pollen-4402')
        ]
    },
    {
        name: 'encoded-path-kept',
        prompt: ask('/my%20docs', 'What is the docs code?'),
        checks: run => [
            calledWith(run, url('/my%20docs')),
            noError(run),
            answerHas(run, 'cedar-7761')
        ]
    },
    {
        name: 'localhost-kept',
        prompt: `Use subagent-fetch on http://localhost:${server.port}/tool. What is the default port?`,
        checks: run => [
            calledWith(run, `http://localhost:${server.port}/tool`),
            noError(run),
            answerHas(run, port)
        ]
    },
    {
        name: 'js-section',
        prompt: ask('/js-section', 'Which Safari version first supported dialog?'),
        checks: run => [noError(run), covered(run, 'no'), saysNoDigits(run), noDigits(run)]
    }
]

const digestCases: Case[] = [
    {
        name: 'title-only',
        prompt: ask('/title-only', 'What version is in the page title?'),
        checks: run => [noError(run), answerHas(run, '7.3.9')]
    },
    {
        name: 'h1-repeats-title',
        prompt: ask('/h1-repeats-title', 'What is the h1 heading text?'),
        checks: run => [noError(run), answerHas(run, 'Zorblax Manual')]
    },
    {
        name: 'no-head-tag',
        prompt: ask('/no-head-tag', 'What is the passphrase?'),
        checks: run => [noError(run), answerHas(run, 'kelvar-9912')]
    },
    {
        name: 'meta-before-head',
        prompt: ask('/meta-before-head', 'What is the passphrase?'),
        checks: run => [noError(run), answerHas(run, 'tarbon-4410')]
    },
    {
        name: 'legacy-markup',
        prompt: ask('/legacy', 'What is the h1 heading text?'),
        checks: run => [noError(run), answerHas(run, 'World Wide Web'), answerLacks(run, 'project')]
    },
    {
        name: 'comic-transcript',
        prompt: ask('/comic', 'What is the son named?'),
        checks: run => [noError(run), answerHas(run, 'Robert Tables-Drop')]
    },
    {
        name: 'alt-text',
        prompt: ask('/alt-text', 'Which TCP port does the service listen on?'),
        checks: run => [noError(run), answerHas(run, '7788')]
    },
    {
        name: 'sidebar-meta',
        prompt: ask('/sidebar-meta', 'Which Python versions are required?'),
        checks: run => [noError(run), answerHas(run, '3.10')]
    },
    {
        name: 'code-lines',
        prompt: ask('/code-lines', 'Copy the code example verbatim.'),
        checks: run => [noError(run), answerHas(run, 'const alpha = 17\nconst beta = alpha + 4')]
    },
    {
        name: 'escaped-code',
        prompt: ask('/escaped-code', 'Copy the code example verbatim.'),
        checks: run => [
            noError(run),
            answerHas(run, '>>> limit == __limit__'),
            answerLacks(run, '\\_')
        ]
    },
    {
        name: 'code-anchors',
        prompt: ask('/code-anchors', 'Copy the commands verbatim.'),
        checks: run => [
            noError(run),
            answerHas(run, 'pip install mkdocs-material\nmkdocs serve'),
            answerLacks(run, 'codelineno')
        ]
    },
    {
        name: 'table',
        prompt: ask('/table', 'What is the description of status 425?'),
        checks: run => [noError(run), answerHas(run, 'Too Early')]
    },
    {
        name: 'article-chrome',
        prompt: ask('/article', 'What is the release code?'),
        checks: run => [noError(run), answerHas(run, 'cobalt-5129'), answerLacks(run, 'wisp')]
    },
    {
        name: 'json',
        prompt: ask('/api.json', 'What version is it?'),
        checks: run => [noError(run), answerHas(run, '4.2.7')]
    },
    {
        name: 'pre-listing',
        prompt: ask('/listing', 'What are the titles of entries 3 and 40?'),
        checks: run => [noError(run), answerHas(run, 'Vorn-3'), answerHas(run, 'Vorn-40')]
    },
    {
        name: 'form',
        prompt: ask('/form', "What are the form's method and action?"),
        checks: run => [noError(run), answerHas(run, '/order'), answerHas(run, /post/i)]
    }
]

const sizeCases: Case[] = [
    {
        name: 'long-page-tail',
        prompt: ask('/long', 'What is the final code?'),
        checks: run => [noError(run), answerHas(run, 'drift-2260')]
    },
    {
        name: 'page-too-big',
        prompt: ask('/big-text', 'What is the final code?'),
        checks: run => [
            errorHas(run, 'too big'),
            calledTimes(run, 1),
            answerLacks(run, 'haven-5518')
        ]
    },
    {
        name: 'cjk-too-big',
        prompt: ask('/cjk-big', 'What is the secret number?'),
        checks: run => [errorHas(run, 'too big'), calledTimes(run, 1), answerLacks(run, '8842')]
    }
]

const networkCases: Case[] = [
    {
        name: 'missing-page',
        prompt: ask('/nope', 'Tell me what it says.'),
        checks: run => [errorHas(run, '404'), calledTimes(run, 1), answerHas(run, '404')]
    },
    {
        name: 'error-body',
        prompt: ask('/moved', 'Where is the install guide?'),
        checks: run => [answerHas(run, '/docs/v2/install')]
    },
    {
        name: 'retry-after',
        prompt: ask('/limited', 'Tell me what it says.'),
        checks: run => [
            errorHas(run, '429'),
            errorHas(run, '120'),
            calledTimes(run, 1),
            answerHas(run, '429')
        ]
    },
    {
        name: 'redirect-ok',
        prompt: ask('/hop-ok', 'What is the default port?'),
        checks: run => [noError(run), answerHas(run, port)]
    },
    {
        name: 'redirect-to-404',
        prompt: ask('/hop-404', 'Tell me what it says.'),
        checks: run => [errorHas(run, '404'), errorHas(run, '/vanished')]
    },
    {
        name: 'meta-refresh',
        prompt: ask('/old', 'What is the page code?'),
        checks: run => [noError(run), answerHas(run, 'marbex-3311')]
    },
    {
        name: 'empty-page',
        prompt: ask('/empty', 'Tell me what it says.'),
        checks: run => [errorHas(run, 'no readable text'), calledTimes(run, 1)]
    },
    {
        name: 'user-agent-gate',
        prompt: ask('/agent-gate', 'What is the gate code?'),
        checks: run => [noError(run), answerHas(run, 'flint-9034')]
    },
    {
        name: 'credentials-in-url',
        prompt: `Use subagent-fetch on http://user:${password}@127.0.0.1:${server.port}/auth. What is the vault code?`,
        checks: run => [noError(run), errorLacks(run, password), answerHas(run, 'onyx-6167')]
    },
    {
        name: 'unsupported-type',
        prompt: ask('/manual.pdf', 'What does the manual say?'),
        checks: run => [errorHas(run, 'application/pdf'), calledTimes(run, 1)]
    },
    {
        name: 'connection-refused',
        prompt: `Use subagent-fetch on ${refused}. What is the default port?`,
        checks: run => [anyErrored(run), calledTimes(run, 1), answerLacks(run, port)]
    },
    {
        name: 'redirect-loop',
        prompt: ask('/loop', 'What is the page code?'),
        checks: run => [anyErrored(run), calledTimes(run, 1), noDigits(run)]
    },
    {
        name: 'gzip',
        prompt: ask('/gzip', 'What is the packed code?'),
        checks: run => [noError(run), answerHas(run, 'zephyr-1188')]
    },
    {
        name: 'javascript-type',
        prompt: ask('/script.js', 'What is the value of LIMIT?'),
        checks: run => [noError(run), answerHas(run, '4471')]
    },
    {
        name: 'octet-text',
        prompt: ask('/blob', 'What is the token?'),
        checks: run => [noError(run), answerHas(run, 'plumb-3382')]
    },
    {
        name: 'latin1-no-charset',
        prompt: ask('/latin1.txt', 'What is the secret word? Copy it exactly.'),
        checks: run => [noError(run), answerHas(run, 'sqûrtel')]
    },
    {
        name: 'cp1251-header',
        prompt: ask('/cp1251', 'What is the secret animal? Copy it exactly.'),
        checks: run => [noError(run), answerHas(run, 'лось')]
    },
    {
        name: 'shift-jis-meta',
        prompt: ask('/sjis', 'What is the secret animal? Copy it exactly.'),
        checks: run => [noError(run), answerHas(run, '猫')]
    }
]

const cases = [...agentCases, ...digestCases, ...sizeCases, ...networkCases]

const failed = await runCases({
    cases,
    // The random port may itself contain a digit string a check looks for.
    run: async testCase => {
        const run = await runPi(testCase.prompt, 'subagent-fetch')
        return {...run, answer: run.answer.replaceAll(base, '')}
    },
    transcripts
})
await server.stop()
process.exit(failed === 0 ? 0 : 1)
