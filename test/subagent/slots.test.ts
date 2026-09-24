import {describe, expect, mock, test} from 'bun:test'

import {createSlots} from '../../src/subagent/slots'

type Deferred = {
    promise: Promise<string>
    resolve: (value: string) => void
    reject: (e: Error) => void
}

const deferred = (): Deferred => {
    let resolve: (value: string) => void = () => undefined
    let reject: (e: Error) => void = () => undefined
    const promise = new Promise<string>((res, rej) => {
        resolve = res
        reject = rej
    })
    return {promise, resolve, reject}
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))
describe('slots', () => {
    test('runs at most the cap at once, in order, and frees a slot on resolve or reject', async () => {
        const slots = createSlots()
        slots.setCap(2)
        const jobs = [deferred(), deferred(), deferred()]
        const started: number[] = []
        const onWait = mock(() => undefined)
        const runs = jobs.map((job, index) =>
            slots.run(() => {
                started.push(index)
                return job.promise
            }, onWait)
        )
        expect(started).toEqual([0, 1])
        expect(onWait).toHaveBeenCalledTimes(1)

        jobs[0]?.reject(new Error('boom'))
        await expect(runs[0]).rejects.toThrow('boom')
        expect(started).toEqual([0, 1, 2])

        jobs[1]?.resolve('one')
        jobs[2]?.resolve('two')
        expect(await Promise.all([runs[1], runs[2]])).toEqual(['one', 'two'])
    })

    test('starts everything at once by default', async () => {
        const slots = createSlots()
        const jobs = [deferred(), deferred(), deferred()]
        const started: number[] = []
        const runs = jobs.map((job, index) =>
            slots.run(
                () => {
                    started.push(index)
                    return job.promise
                },
                () => {
                    throw new Error('waited')
                }
            )
        )
        expect(started).toEqual([0, 1, 2])
        for (const job of jobs) job.resolve('ok')
        expect(await Promise.all(runs)).toEqual(['ok', 'ok', 'ok'])
    })

    test('a lower cap holds new starts, and a raised cap drains the queue', async () => {
        const slots = createSlots()
        const jobs = [deferred(), deferred(), deferred()]
        const started: number[] = []
        const run = (index: number) =>
            slots.run(
                () => {
                    started.push(index)
                    return jobs[index]?.promise ?? Promise.reject(new Error('missing'))
                },
                () => undefined
            )
        slots.setCap(2)
        const runs = [run(0), run(1)]
        slots.setCap(1)
        runs.push(run(2))
        expect(started).toEqual([0, 1])

        jobs[0]?.resolve('a')
        await runs[0]
        await settle()
        expect(started).toEqual([0, 1])

        slots.setCap(2)
        expect(started).toEqual([0, 1, 2])

        jobs[1]?.resolve('b')
        jobs[2]?.resolve('c')
        expect(await Promise.all(runs)).toEqual(['a', 'b', 'c'])
    })
})
