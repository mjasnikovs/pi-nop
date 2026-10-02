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
    describe('with a tool that waits on the user', () => {
        const waits = new Set(['ask_user'])
        const asks = Array.from({length: 10}, (_, index) => ({question: `q${String(index)}`}))
        test('calls refused beside a question on screen wait for its end, and an answer clears them', () => {
            const onTrip = trip()
            const guard = createGround(onTrip, createVisited(), waits)

            for (const args of asks) guard.onEvent(start('ask_user', args))
            for (const args of asks.slice(1)) guard.onEvent(end('ask_user', args, {isError: true}))
            expect(onTrip).not.toHaveBeenCalled()

            guard.onEvent(end('ask_user', asks[0]))

            for (let turn = 0; turn < 7; turn += 1) {
                guard.onEvent(start('ask_user', {turn}))
                guard.onEvent(end('ask_user', {turn}, {isError: true}))
            }

            expect(onTrip).not.toHaveBeenCalled()
        })

        test('a refused question asked again and then answered is not a repeat', () => {
            const onTrip = trip()
            const guard = createGround(onTrip, createVisited(), waits)
            const pair = (turn: number) => [asks[turn], asks[turn + 1]]

            for (let turn = 0; turn < 8; turn += 1) {
                const [shown, refused] = pair(turn)
                guard.onEvent(start('ask_user', shown, `shown-${String(turn)}`))
                guard.onEvent(start('ask_user', refused, `refused-${String(turn)}`))
                guard.onEvent(
                    end('ask_user', refused, {isError: true, toolCallId: `refused-${String(turn)}`})
                )
                guard.onEvent(end('ask_user', shown, {toolCallId: `shown-${String(turn)}`}))
            }

            expect(onTrip).not.toHaveBeenCalled()
        })

        test('another tool failing in the batch does not count the held refusals early', () => {
            const onTrip = trip()
            const guard = createGround(onTrip, createVisited(), waits)

            for (let i = 0; i < 6; i += 1) {
                guard.onEvent(start('read', {path: `missing${String(i)}`}))
                guard.onEvent(end('read', {path: `missing${String(i)}`}, {isError: true}))
            }

            guard.onEvent(start('ask_user', asks[0]))
            guard.onEvent(start('ask_user', asks[1]))
            guard.onEvent(start('read', {path: 'missing'}))
            guard.onEvent(end('ask_user', asks[1], {isError: true}))
            guard.onEvent(end('read', {path: 'missing'}, {isError: true}))
            expect(onTrip).not.toHaveBeenCalled()

            guard.onEvent(end('ask_user', asks[0]))
            guard.onEvent(start('read', {path: 'gone'}))
            guard.onEvent(end('read', {path: 'gone'}, {isError: true}))
            expect(onTrip).not.toHaveBeenCalled()
        })

        test('a dead call of another tool beside a question waits for the question to end', () => {
            const onTrip = trip()
            const guard = createGround(onTrip, createVisited(), waits)

            for (let i = 0; i < 7; i += 1) {
                guard.onEvent(start('read', {path: `missing${String(i)}`}))
                guard.onEvent(end('read', {path: `missing${String(i)}`}, {isError: true}))
            }

            guard.onEvent(start('ask_user', asks[0]))
            guard.onEvent(start('read', {path: 'missing0'}, 'again'))
            guard.onEvent(end('read', {path: 'missing0'}, {toolCallId: 'again'}))
            expect(onTrip).not.toHaveBeenCalled()

            guard.onEvent(end('ask_user', asks[0], {isError: true}))
            expect(onTrip).toHaveBeenCalledTimes(1)
        })

        test('two questions under one call id still count as two in flight', () => {
            const onTrip = trip()
            const guard = createGround(onTrip, createVisited(), waits)

            for (let i = 0; i < 7; i += 1) {
                guard.onEvent(start('read', {path: `missing${String(i)}`}))
                guard.onEvent(end('read', {path: `missing${String(i)}`}, {isError: true}))
            }

            guard.onEvent(start('ask_user', asks[0], 'same'))
            guard.onEvent(start('ask_user', asks[1], 'same'))
            guard.onEvent(end('ask_user', asks[1], {isError: true, toolCallId: 'same'}))
            expect(onTrip).not.toHaveBeenCalled()

            guard.onEvent(end('ask_user', asks[0], {toolCallId: 'same'}))
            expect(onTrip).not.toHaveBeenCalled()

            for (let i = 0; i < 8; i += 1) {
                guard.onEvent(start('read', {path: `gone${String(i)}`}))
                guard.onEvent(end('read', {path: `gone${String(i)}`}, {isError: true}))
            }

            expect(onTrip).toHaveBeenCalledTimes(1)
        })

        test('an answer that returns before a refusal still clears the batch', () => {
            const onTrip = trip()
            const guard = createGround(onTrip, createVisited(), waits)

            for (let i = 0; i < 7; i += 1) {
                guard.onEvent(start('read', {path: `missing${String(i)}`}))
                guard.onEvent(end('read', {path: `missing${String(i)}`}, {isError: true}))
            }

            guard.onEvent(start('ask_user', asks[0]))
            guard.onEvent(start('ask_user', asks[1]))
            guard.onEvent(end('ask_user', asks[0]))
            guard.onEvent(end('ask_user', asks[1], {isError: true}))

            expect(onTrip).not.toHaveBeenCalled()
        })

        test('a reworded question answered from memory counts as dead', () => {
            const onTrip = trip()
            const guard = createGround(onTrip, createVisited(), waits)
            const reworded = (index: number) => ({question: 'Which DB?', options: [index]})

            for (let i = 0; i < 7; i += 1) {
                guard.onEvent(start('ask_user', reworded(i)))
                guard.onEvent(end('ask_user', reworded(i), {details: {repeat: true}}))
            }

            expect(onTrip).not.toHaveBeenCalled()

            guard.onEvent(start('ask_user', reworded(7)))
            guard.onEvent(end('ask_user', reworded(7), {details: {repeat: false}}))
            expect(onTrip).not.toHaveBeenCalled()

            for (let i = 8; i < 16; i += 1) {
                guard.onEvent(start('ask_user', reworded(i)))
                guard.onEvent(end('ask_user', reworded(i), {details: {repeat: true}}))
            }

            expect(onTrip).toHaveBeenCalledTimes(1)
        })

        test('the same question shown twice is a repeat', () => {
            const onTrip = trip()
            const guard = createGround(onTrip, createVisited(), waits)
            guard.onEvent(start('ask_user', asks[0], 'first'))
            guard.onEvent(end('ask_user', asks[0], {toolCallId: 'first'}))

            for (let i = 0; i < 8; i += 1) {
                guard.onEvent(start('ask_user', asks[0], `again-${String(i)}`))
                guard.onEvent(end('ask_user', asks[0], {toolCallId: `again-${String(i)}`}))
            }

            expect(onTrip).toHaveBeenCalledTimes(1)
        })

        test('a batch where every call is refused counts in full once its last call ends', () => {
            const onTrip = trip()
            const guard = createGround(onTrip, createVisited(), waits)
            const batch = (turn: number) => asks.slice(0, 3).map(args => ({...args, turn}))

            for (const turn of [1, 2]) {
                for (const args of batch(turn)) guard.onEvent(start('ask_user', args))
                for (const args of batch(turn))
                    guard.onEvent(end('ask_user', args, {isError: true}))
            }

            expect(onTrip).not.toHaveBeenCalled()

            for (const args of batch(3)) guard.onEvent(start('ask_user', args))

            for (const args of batch(3).slice(1)) {
                guard.onEvent(end('ask_user', args, {isError: true}))
            }

            expect(onTrip).not.toHaveBeenCalled()

            guard.onEvent(end('ask_user', batch(3)[0], {isError: true}))
            expect(onTrip).toHaveBeenCalledTimes(1)
        })
    })

    test('trips after eight errors in a row', () => {
        const {onTrip, call} = ground()
        for (let i = 0; i < 7; i += 1) call('read', {path: `missing${i}.ts`}, true)
        expect(onTrip).not.toHaveBeenCalled()

        call('read', {path: 'missing7.ts'}, true)
        expect(onTrip).toHaveBeenCalledWith({
            id: 'ground',
            hint: expect.stringContaining('8 tool calls in a row that brought nothing new')
        })
        expect((onTrip.mock.calls[0] as [{hint: string}])[0].hint).not.toContain('missing0.ts')
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
