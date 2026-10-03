import {describe, expect, test} from 'bun:test'
import {join} from 'node:path'
import type {SessionEntry} from '@earendil-works/pi-coding-agent'

import type {Steps} from '../../src/plan/steps'
import {names, progress, statusText, writes} from '../../src/plan/track'
import {tempTree} from '../tree'

const call = (name: string, args: object) => ({type: 'toolCall', id: name, name, arguments: args})
const said = (role: string, ...content: object[]): SessionEntry =>
    ({type: 'message', message: {role, content}}) as unknown as SessionEntry
const cwd = tempTree({'src/greet.js': 'x', 'src/cli.js': 'x'})
const plan: Steps = {
    steps: [
        'Add farewell to src/greet.js.',
        'Handle farewell in src/cli.js, importing it from src/greet.js.',
        'Run npm test.'
    ],
    files: [
        {path: 'src/greet.js', state: 'existing'},
        {path: 'src/cli.js', state: 'existing'}
    ]
}
describe('writes', () => {
    test('gives the path of every edit and write call, in order', () => {
        const entries = [
            said('assistant', call('edit', {path: 'a.js'}), {type: 'text', text: 'hi'}),
            said('assistant', call('write', {path: 'b.js'}))
        ]
        expect(writes(entries)).toEqual(['a.js', 'b.js'])
    })

    test('skips other tools, other roles and other entries', () => {
        const entries = [
            said('assistant', call('read', {path: 'a.js'}), call('bash', {command: 'ls'})),
            said('user', call('edit', {path: 'b.js'})),
            {type: 'custom', customType: 'plan-mode'} as unknown as SessionEntry
        ]
        expect(writes(entries)).toEqual([])
    })

    test('gives a path written twice once', () => {
        const entries = [
            said('assistant', call('edit', {path: 'a.js'}), call('write', {path: 'a.js'})),
            said('assistant', call('edit', {path: 'a.js'}))
        ]
        expect(writes(entries)).toEqual(['a.js'])
    })

    test('skips a call whose path is not text', () => {
        expect(writes([said('assistant', call('edit', {}), call('write', {path: 3}))])).toEqual([])
    })
})

describe('names', () => {
    test.each([
        ['Fix `src/a.ts`.', true],
        ['Fix src/a.ts, then run.', true],
        ['src/a.ts', true],
        ['Fix (src/a.ts)', true],
        ['Fix src/a.tsx.', false],
        ['Fix src/a.ts.bak', false],
        ['Fix test/src/a.ts', false],
        ['Import from ../src/a.ts', false],
        ['Fix src/a.ts/index', false],
        ['Fix my-src/a.ts', false],
        ['Fix lib.src/a.ts', false],
        ['Fix src/a.ts-old', false],
        ['Fix the code.', false]
    ])('%s', (step, linked) => {
        expect(names(step, 'src/a.ts')).toBe(linked)
    })

    test('one whole mention is enough beside a longer path', () => {
        expect(names('Copy src/a.tsx over src/a.ts.', 'src/a.ts')).toBe(true)
    })
})

describe('progress', () => {
    test('nothing written leaves every file and linked step open', async () => {
        expect(await progress(cwd, plan, [])).toEqual({
            files: [false, false],
            steps: ['open', 'open', 'untracked'],
            outside: [],
            written: 0,
            total: 2
        })
    })

    test('a step is done only when every file it names was written', async () => {
        const first = await progress(cwd, plan, ['src/greet.js'])
        const both = await progress(cwd, plan, ['src/greet.js', 'src/cli.js'])
        expect(first.steps).toEqual(['done', 'open', 'untracked'])
        expect(first.files).toEqual([true, false])
        expect(both.steps).toEqual(['done', 'done', 'untracked'])
        expect(both.written).toBe(2)
    })

    test('a written path is matched however the call spelled it', async () => {
        const calls = [join(cwd, 'src/greet.js'), './src/cli.js', '@src/cli.js']
        expect(await progress(cwd, plan, calls)).toMatchObject({files: [true, true], outside: []})
    })

    test('a written file the plan does not list is outside, once, relative to cwd', async () => {
        const calls = ['NOTES.md', join(cwd, 'NOTES.md'), 'docs/new.md', 'src/greet.js']
        expect((await progress(cwd, plan, calls)).outside).toEqual(['NOTES.md', 'docs/new.md'])
    })

    test('two rows for one file count once', async () => {
        const twice: Steps = {
            steps: ['Fix src/greet.js.'],
            files: [
                {path: 'src/greet.js', state: 'existing'},
                {path: './src/greet.js', state: 'existing'}
            ]
        }
        expect(await progress(cwd, twice, ['src/greet.js'])).toMatchObject({
            files: [true, true],
            written: 1,
            total: 1
        })
    })
})

describe('statusText', () => {
    const base = {files: [], steps: [], written: 3, total: 4}
    test('counts the plan files', () => {
        expect(statusText({...base, outside: []})).toBe('plan: files 3/4')
    })

    test('adds the outside count when there is one', () => {
        expect(statusText({...base, outside: ['a', 'b']})).toBe('plan: files 3/4 · outside 2')
    })
})
