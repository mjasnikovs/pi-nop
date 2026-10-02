const goalLabel = 'GOAL:'
const goalLayout = `${goalLabel} <one sentence, what changes for the user>`

const goalPrompt = `You turn a request into one goal sentence for a coding task.
Read a file only when the request names something you must check.
Answer with one line and nothing else:
${goalLayout}`

const noGoalNote = `[SYSTEM NOTE: Your reply had no GOAL line, so it was not accepted. Answer again with one line and nothing else:
${goalLayout}]`

type GoalTask = {
    request?: string
    goal?: string
    change?: string
}

const goalTask = ({request, goal, change}: GoalTask): string =>
    [
        ['Request', request],
        ['Current goal', goal],
        ['Change asked by the user', change]
    ]
        .filter(([, value]) => value !== undefined)
        .map(([label, value]) => `${label}: ${value}`)
        .join('\n')

const parseGoal = (text: string): string | undefined => {
    const line = text
        .split('\n')
        .map(row => row.replace(/[`*]/g, '').trim())
        .find(row => row.startsWith(goalLabel))
    const goal = line?.slice(goalLabel.length).trim()

    return goal === undefined || goal === '' ? undefined : goal
}

const sendBackGoal = (reply: string): string | undefined =>
    parseGoal(reply) === undefined ? noGoalNote : undefined

export {goalPrompt, goalTask, noGoalNote, parseGoal, sendBackGoal}
export type {GoalTask}
