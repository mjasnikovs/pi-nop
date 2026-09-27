const goalLabel = 'GOAL:'

const goalPrompt = `You turn a request into one goal sentence for a coding task.
Read a file only when the request names something you must check.
Answer with one line and nothing else:
${goalLabel} <one sentence, what changes for the user>`

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

export {goalPrompt, goalTask, parseGoal}
export type {GoalTask}
