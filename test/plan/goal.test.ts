import {describe, expect, test} from 'bun:test'

import {goalTask, parseGoal} from '../../src/plan/goal'

describe('goalTask', () => {
    test('first request carries only the request', () => {
        expect(goalTask({request: 'fix it'})).toBe('Request: fix it')
    })

    test('a change carries the current goal and the change', () => {
        expect(goalTask({request: 'fix it', goal: 'Fix the typo.', change: 'add a test'})).toBe(
            'Request: fix it\nCurrent goal: Fix the typo.\nChange asked by the user: add a test'
        )
    })
})

describe('parseGoal', () => {
    test('takes the GOAL line and strips markdown', () => {
        expect(parseGoal('Sure.\n**GOAL:** Fix the `greet` typo.\n')).toBe('Fix the greet typo.')
    })

    test('no GOAL line is undefined', () => {
        expect(parseGoal('I fixed it.')).toBeUndefined()
        expect(parseGoal('GOAL:')).toBeUndefined()
    })
})
