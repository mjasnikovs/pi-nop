import {readFile, stat} from 'node:fs/promises'

import type {ExtensionToolContext} from '@earendil-works/pi-coding-agent'
import {createReadToolDefinition, defineTool} from '@earendil-works/pi-coding-agent'
import {stripTerminalSequences} from '@earendil-works/pi-tui'
import {type Static, Type} from 'typebox'

import type {GoalTask} from './goal'
import {goalTask} from './goal'

const askToolName = 'ask_user'
const none = 'NONE'

enum AskErrors {
    NotYet = 'Not asking yet. Give the GOAL line.',
    Question = 'Ask the user one question.',
    OnePerCall = 'One question per call. Ask again after this answer.',
    Options = 'Give 2 to 5 options.',
    Evidence = 'The evidence line is not in that file. Copy one whole line exactly, or use NONE.',
    Closed = 'The user closed the question.'
}

// Every string the model sees here was measured as written (PLANNING_MODE.md, section 10).
const askDescription = 'Ask the user one question. Give 2 to 5 options. Call once per question.'
const askParameters = Type.Object({
    question: Type.String(),
    options: Type.Array(Type.String()),
    evidence: Type.Object({
        file: Type.String({description: 'Path of a file you read, or NONE.'}),
        line: Type.String({description: 'One whole line, copied exactly from the file, or NONE.'})
    })
})
const acceptRules = `The user accepted the goal.
You are planning, not implementing. Do not change any file.
Now find what is still open before the work can start. Read the code you need.
If something is unclear, call ${askToolName} with one question and options. Ask one question per call and wait for the answer.
When nothing is open, answer with one line: DONE`
const decisionsLabel = 'Decisions so far:'
// pi-task's hand-over paragraph, copied because pi-task is not a dependency.
const settled =
    'PLANNING DECISIONS — these were settled with the user before this task was started. '
    + 'They are authoritative: implement them as written, and do not re-open or contradict '
    + 'them. They may not cover everything; decide anything they leave open as usual.'

type Evidence = Static<typeof askParameters>['evidence']
type Question = {question: string; options: string[]; evidence?: Evidence}
type Decision = {question: string; answer: string}

type AskHost = {
    cwd: string
    open: () => boolean
    /** False when this assistant turn already asked. */
    claim: () => boolean
    stored: (question: string) => string | undefined
    /** Returns what takes the question off the screen again. */
    show: (question: Question, answer: (text: string) => void) => () => void
}

type Call = {signal: AbortSignal | undefined; ctx: ExtensionToolContext}

const sameQuestion = (left: string, right: string): boolean => {
    const key = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

    return key(left) === key(right)
}

const distinctOptions = (options: string[]): string[] => [
    ...new Set(
        options.map(option => stripTerminalSequences(option).trim()).filter(option => option !== '')
    )
]

const isNone = ({file, line}: Evidence): boolean => file.trim() === none && line.trim() === none

// pi's read tool finds the file, so a path the model read with resolves the same way here.
const fileText = async (cwd: string, file: string, {signal, ctx}: Call): Promise<string> => {
    let text = ''
    const read = createReadToolDefinition(cwd, {
        operations: {
            // A pipe or a device never ends, and the wait on it would hold the slot.
            access: async path => {
                if (!(await stat(path)).isFile()) throw new Error(path)
            },
            readFile: async path => {
                const buffer = await readFile(path, {signal})
                text = buffer.toString('utf8')
                return buffer
            }
        }
    })
    await read.execute(askToolName, {path: file, limit: 1}, signal, undefined, ctx)
    return text
}

const quoted = async (cwd: string, evidence: Evidence, call: Call): Promise<boolean> => {
    if (isNone(evidence)) return true

    const wanted = evidence.line.trim()

    if (wanted === '') return false

    try {
        const text = await fileText(cwd, evidence.file, call)
        return text.split('\n').some(row => row.trim() === wanted)
    } catch {
        return false
    }
}

const transcript = (decisions: Decision[]): string[] =>
    decisions.flatMap(({question, answer}, index) => [
        `Q${String(index + 1)}: ${question}`,
        `A${String(index + 1)}: ${answer}`
    ])

const questionsTask = (unseen: GoalTask, decisions: Decision[]): string => {
    const answered = decisions.length === 0 ? [] : [decisionsLabel, ...transcript(decisions)]
    const head = [goalTask(unseen), ...answered].filter(line => line !== '')

    if (head.length === 0) return acceptRules
    return [...head, '', acceptRules].join('\n')
}

const handOverMessage = (goal: string, decisions: Decision[]): string => {
    if (decisions.length === 0) return goal
    return [goal, settled, transcript(decisions).join('\n')].join('\n\n')
}

const shown = (
    host: AskHost,
    signal: AbortSignal | undefined,
    question: Question
): Promise<string> =>
    new Promise((answered, closed) => {
        // Claimed last, so a refused or already answered call does not use up the turn.
        if (!host.claim()) {
            closed(new Error(AskErrors.OnePerCall))
            return
        }

        const onScreen: {hide?: () => void} = {}

        // A guard can stop the run while the panel stays open, so the question must go too.
        const gone = (): void => {
            onScreen.hide?.()
            closed(new Error(AskErrors.Closed))
        }
        signal?.addEventListener('abort', gone, {once: true})
        onScreen.hide = host.show(question, text => {
            signal?.removeEventListener('abort', gone)
            answered(text)
        })
    })

const askTool = (host: AskHost) =>
    defineTool({
        name: askToolName,
        label: 'Ask user',
        description: askDescription,
        parameters: askParameters,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            if (!host.open()) throw new Error(AskErrors.NotYet)
            if (stripTerminalSequences(params.question).trim() === '')
                throw new Error(AskErrors.Question)

            const options = distinctOptions(params.options)

            if (options.length < 2) throw new Error(AskErrors.Options)
            const verified = await quoted(host.cwd, params.evidence, {signal, ctx})

            // pi leaves a waiting tool unsettled on abort, and a listener added after it never fires.
            if (signal?.aborted) throw new Error(AskErrors.Closed)
            if (!verified) throw new Error(AskErrors.Evidence)

            const stored = host.stored(params.question)
            const answer =
                stored
                ?? (await shown(host, signal, {
                    question: params.question,
                    options,
                    evidence: isNone(params.evidence) ? undefined : params.evidence
                }))

            // The ground guard reads repeat, since a reworded question has a new call key.
            return {
                content: [{type: 'text', text: `Answer: ${answer}`}],
                details: {repeat: stored !== undefined}
            }
        }
    })

export {
    acceptRules,
    AskErrors,
    askTool,
    askToolName,
    distinctOptions,
    handOverMessage,
    questionsTask,
    quoted,
    sameQuestion
}
export type {AskHost, Decision, Question}
