import {describe, expect, test} from 'bun:test'

import {createLoop} from '../../../src/subagent/guards/loop'
import {createVisited} from '../../../src/subagent/guards/visited'
import {end, start, trip, turnStart} from './fake'

const loop = () => {
    const onTrip = trip()
    const visited = createVisited()
    const guard = createLoop(onTrip, visited)

    const send = (...events: Parameters<typeof guard.onEvent>[0][]) => {
        for (const event of events) {
            visited.onEvent(event)
            guard.onEvent(event)
        }
    }

    return {onTrip, send, guard}
}
describe('createLoop', () => {
    test('trips on the fifth identical call within the window, whatever the key order', () => {
        const {onTrip, send} = loop()
        for (let i = 0; i < 4; i += 1) send(start('grep', {path: 'src', pattern: 'x'}))
        send(turnStart)
        expect(onTrip).not.toHaveBeenCalled()

        send(start('grep', {pattern: 'x', path: 'src'}))
        expect(onTrip).toHaveBeenCalledTimes(1)
        const [hit] = onTrip.mock.calls[0] as [{id: string; hint: string}]
        expect(hit.id).toBe('loop')
        expect(hit.hint).toContain('grep({"pattern":"x","path":"src"}) 5 times')
        expect(hit.hint).toContain('last 20 tool calls')
        expect(hit.hint).not.toContain('Its reads')
    })

    test('forgets calls that fall out of the window', () => {
        const {onTrip, send} = loop()
        for (let i = 0; i < 4; i += 1) send(start('ls', {path: '.'}))
        for (let i = 0; i < 17; i += 1) send(start('read', {path: `f${i}.ts`}))
        send(start('ls', {path: '.'}))

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('trips when a path is re-read five times without new lines', () => {
        const {onTrip, send} = loop()

        const read = (offset: number, limit: number) => {
            send(start('read', {path: 'a.ts', offset, limit}))
            send(end('read', {path: 'a.ts', offset, limit}))
        }
        read(1, 100)
        read(101, 100)
        read(1, 50)
        read(50, 50)
        read(20, 100)
        read(100, 100)
        read(201, 100)
        expect(onTrip).not.toHaveBeenCalled()

        send(start('read', {path: 'a.ts', offset: 1, limit: 10}))
        expect(onTrip).toHaveBeenCalledTimes(1)
        const [hit] = onTrip.mock.calls[0] as [{id: string; hint: string}]
        expect(hit.hint).toContain('re-read a.ts 5 times')
        expect(hit.hint).toContain(
            'a.ts (lines 1-100, 101-200, 1-50, 50-99, 20-119, 100-199, 201-300)'
        )
    })

    test('an errored read does not raise the high-water line for its path', () => {
        const {onTrip, send} = loop()
        send(start('read', {path: 'a.ts', offset: 2001}))
        send(end('read', {path: 'a.ts', offset: 2001}, {isError: true}))

        for (const offset of [1, 101, 201, 301, 401, 501]) {
            send(start('read', {path: 'a.ts', offset, limit: 100}))
            send(end('read', {path: 'a.ts', offset, limit: 100}))
        }

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('string offsets that pi coerces still count as paging forward', () => {
        const {onTrip, send} = loop()
        send(start('read', {path: 'a.ts'}))
        for (const offset of ['2001', '4001', '6001', '8001', '10001', '12001'])
            send(start('read', {path: 'a.ts', offset}))

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('paging forward with offset only, past the read cap, is progress', () => {
        const {onTrip, send} = loop()
        send(start('read', {path: 'big.d.ts'}))
        for (let i = 1; i < 8; i += 1) send(start('read', {path: 'big.d.ts', offset: 2000 * i + 1}))

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('paging past where the byte cap cut a read is progress', () => {
        const {onTrip, send} = loop()
        send(start('read', {path: 'big.ts'}))
        send(end('read', {path: 'big.ts'}, {details: {truncation: {outputLines: 1300}}}))

        for (let i = 0; i < 6; i += 1) {
            const offset = 1301 + i * 100
            send(start('read', {path: 'big.ts', offset, limit: 100}))
            send(end('read', {path: 'big.ts', offset, limit: 100}))
        }

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('reads of other paths and greps on the same path do not count as revisits', () => {
        const {onTrip, send} = loop()
        send(start('read', {path: 'a.ts'}))
        for (let i = 0; i < 4; i += 1) send(start('grep', {path: 'a.ts', pattern: `p${i}`}))
        for (let i = 0; i < 4; i += 1) send(start('read', {path: `b${i}.ts`}))
        send(start('read', {path: 'a.ts', offset: 1, limit: 10}))

        expect(onTrip).not.toHaveBeenCalled()
    })

    test('dispose is a no-op', () => {
        expect(() => loop().guard.dispose()).not.toThrow()
    })
})
