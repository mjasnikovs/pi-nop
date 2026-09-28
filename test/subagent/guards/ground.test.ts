import {describe, expect, test} from 'bun:test'

import {createGround} from '../../../src/subagent/guards/ground'
import {createVisited} from '../../../src/subagent/guards/visited'
import {end, start, trip, turnStart} from './fake'

const ground = () => {
    const onTrip = trip()
    const visited = createVisited()
    const guard = createGround(onTrip, visited)

    const call = (name: string, args: unknown, isError = false) => {
        for (const event of [start(name, args), end(name, args, {isError})]) {
            visited.onEvent(event)
            guard.onEvent(event)
        }
    }

    return {onTrip, call, guard}
}
describe('createGround', () => {
    test('trips after eight errors in a row', () => {
        const {onTrip, call} = ground()
        for (let i = 0; i < 7; i += 1) call('read', {path: `missing${i}.ts`}, true)
        expect(onTrip).not.toHaveBeenCalled()

        call('read', {path: 'missing7.ts'}, true)
        expect(onTrip).toHaveBeenCalledWith({
            id: 'ground',
            hint: expect.stringContaining('8 tool calls in a row that brought nothing new')
        })
        expect((onTrip.mock.calls[0] as [{hint: string}])[0].hint).toContain('missing0.ts')
    })

    test('repeats of earlier calls count as dead, in any mix with errors', () => {
        const {onTrip, call} = ground()
        call('ls', {path: '.'})
        call('grep', {path: '.', pattern: 'x'})
        for (let i = 0; i < 4; i += 1) call('ls', {path: '.'})
        for (let i = 0; i < 3; i += 1) call('grep', {path: '.', pattern: 'x'}, i === 1)
        expect(onTrip).not.toHaveBeenCalled()

        call('read', {path: 'a.ts'}, true)
        expect(onTrip).toHaveBeenCalledTimes(1)
    })

    test('a fresh successful call resets the streak', () => {
        const {onTrip, call, guard} = ground()
        for (let i = 0; i < 7; i += 1) call('read', {path: 'gone.ts'}, true)
        guard.onEvent(turnStart)
        call('read', {path: 'here.ts'})
        for (let i = 0; i < 7; i += 1) call('read', {path: 'gone.ts'}, true)

        expect(onTrip).not.toHaveBeenCalled()
        guard.dispose()
    })
})
