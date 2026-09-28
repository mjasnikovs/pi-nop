import {describe, expect, test} from 'bun:test'

import {createChurn} from '../../../src/subagent/guards/churn'
import {end, start, trip} from './fake'

describe('createChurn', () => {
    test('trips once tool results outgrow twice the context window', () => {
        const onTrip = trip()
        const guard = createChurn(onTrip, 100)
        const page = 'x'.repeat(400)
        guard.onEvent(start('read', {path: 'a.ts'}))
        guard.onEvent(end('read', {path: 'a.ts'}, {text: page}))
        guard.onEvent(end('read', {path: 'b.ts'}, {text: page}))
        expect(onTrip).not.toHaveBeenCalled()

        guard.onEvent(end('read', {path: 'c.ts'}, {text: 'x'}))
        expect(onTrip).toHaveBeenCalledWith({
            id: 'churn',
            hint: expect.stringContaining('context window holds twice over')
        })
        guard.dispose()
    })
})
