import {describe, expect, test} from 'bun:test'

import {goalPrompt, goalTask, noGoalNote, parseGoal, sendBackGoal} from '../../src/plan/goal'

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

describe('sendBackGoal', () => {
    test('a reply with a goal is accepted', () => {
        expect(sendBackGoal('GOAL: Fix the typo.')).toBeUndefined()
        expect(sendBackGoal('**GOAL:** Fix the typo.')).toBeUndefined()
    })

    test('a reply with no goal, or an empty one, gets the note', () => {
        expect(sendBackGoal('These tests are missing:\n- a.test.ts')).toBe(noGoalNote)
        expect(sendBackGoal('')).toBe(noGoalNote)
        expect(sendBackGoal('GOAL:')).toBe(noGoalNote)
    })

    test('the note asks for the layout the prompt asks for', () => {
        const layout = goalPrompt.split('\n').at(-1) ?? ''
        expect(layout).toStartWith('GOAL: <')
        expect(noGoalNote).toEndWith(`\n${layout}]`)
    })
})
