import {beforeEach, describe, expect, mock, test} from 'bun:test'
import type {OverlayHandle} from '@earendil-works/pi-tui'

import {whileHidden} from '../../src/tui/hidden'

const setHidden = mock((_hidden: boolean) => undefined)
const overlay = {setHidden} as unknown as OverlayHandle
beforeEach(() => {
    setHidden.mockClear()
})

describe('whileHidden', () => {
    test('hides the overlay for the run and returns its answer', async () => {
        const answer = await whileHidden(overlay, () => {
            expect(setHidden.mock.calls).toEqual([[true]])
            return Promise.resolve('yes')
        })
        expect(answer).toBe('yes')
        expect(setHidden.mock.calls).toEqual([[true], [false]])
    })

    test('shows the overlay again when the run fails', async () => {
        const failed = whileHidden(overlay, () => Promise.reject(new Error('boom')))
        expect(failed).rejects.toThrow('boom')
        await failed.catch(() => undefined)
        expect(setHidden.mock.calls).toEqual([[true], [false]])
    })

    test('runs without an overlay', async () => {
        expect(await whileHidden(undefined, () => Promise.resolve(1))).toBe(1)
    })
})
