import {createReadTool} from '@earendil-works/pi-coding-agent'
import {stripTerminalSequences} from '@earendil-works/pi-tui'

import type {SendBack} from '../subagent/subagent'
import {regularFile} from './ask'
import {goalTask} from './goal'

const stepsLabel = 'STEPS:'
const filesLabel = 'FILES:'
const verifyLabel = 'VERIFY:'
const labels = [stepsLabel, filesLabel, verifyLabel]
const stepsLayout = `${stepsLabel}
1. <one line per step>
${filesLabel}
- <path> (existing|new)
${verifyLabel}
- <the project's test command, nothing else on the line>`

// Every string the model sees here was measured as written (PLANNING_MODE.md, sections 12, 14).
const stepsRules = `The questions are done.
You are planning, not implementing. Do not change any file.
Now plan the steps that reach the goal, in order. Read the code you need.
Answer with this layout and nothing else:
${stepsLayout}`
const currentLabel = 'Current steps:'

const note = (text: string): string =>
    `[SYSTEM NOTE: ${text} Answer again with this layout and nothing else:\n${stepsLayout}]`
const layoutNote = note('Your reply did not follow the layout, so it was not accepted.')

type PlanFile = {path: string; state: 'existing' | 'new'}
type Steps = {steps: string[]; files: PlanFile[]; verify: string[]}

const misplacedNotes: Record<PlanFile['state'], (path: string) => string> = {
    existing: path =>
        note(`${path} is marked existing but is not on disk. Mark a file the plan creates as new.`),
    new: path => note(`${path} is marked new but is on disk. Mark it existing.`)
}

const stepRow = /^\d+[.)]\s+(.+)$/
const fileRow = /^-\s*(\S.*)\((existing|new)\)$/
const unmarked = (row: string): string => row.replace(/[`*]/g, '').trim()

const fileOf = (row: string): PlanFile | undefined => {
    const [, path, state] = fileRow.exec(row.replaceAll('`', '').trim()) ?? []

    if (path === undefined || (state !== 'existing' && state !== 'new')) return undefined
    // A path with a star is a glob: never on disk, so the new tag would let it through.
    return path.includes('*') ? undefined : {path: path.trim(), state}
}

// The space keeps a row like --coverage whole.
const dash = /^-(?:\s+|$)/
const wrapped = /^`([^`]*)`$/
const noCommand = /^(?:none|\(none\))?$/i
const fence = '```'
// Qwen ends a reply on a leaked closing tag, whole or cut: </parameter>, </tool_call>, </
const closingTag = /^<\/[\w-]*>?$/
const undashed = (row: string): string => row.replace(dash, '')
const notCommand = (row: string): boolean =>
    labels.includes(unmarked(row)) || undashed(row).startsWith(fence)

// A bare row beside dashed ones is text after the commands, not one more command.
const mixed = (rows: string[]): boolean => {
    const dashed = rows.filter(row => dash.test(row)).length

    return dashed > 0 && dashed < rows.length
}

const commandOf = (row: string): string => {
    const bare = undashed(row)

    return (wrapped.exec(bare)?.[1] ?? bare).trim()
}

const parseSteps = (text: string): Steps | undefined => {
    const rows = text
        .split('\n')
        .map(row => stripTerminalSequences(row).trim())
        .filter(row => row !== '')
    const start = rows.findIndex(row => unmarked(row) === stepsLabel)
    const end = rows.findIndex((row, index) => index > start && unmarked(row) === filesLabel)
    const last = rows.findIndex((row, index) => index > end && unmarked(row) === verifyLabel)

    if (start === -1 || end === -1 || last === -1) return undefined

    // A step keeps its backticks and stars: `export * from` must reach the main model whole.
    const steps = rows.slice(start + 1, end).map(row => stepRow.exec(row)?.[1])
    const files = rows.slice(end + 1, last).map(fileOf)
    const commands = rows.slice(last + 1).filter(row => !closingTag.test(row))
    const read = {
        steps: steps.filter(step => step !== undefined),
        files: files.filter(file => file !== undefined),
        verify: commands.map(commandOf).filter(command => !noCommand.test(command))
    }

    if (read.steps.length === 0 || read.steps.length < steps.length) return undefined
    if (read.files.length < files.length || commands.some(notCommand)) return undefined
    return mixed(commands) ? undefined : read
}

const onDisk = async (
    cwd: string,
    path: string,
    signal: AbortSignal | undefined
): Promise<boolean> => {
    // pi's read tool finds the file as the model's read did. It is not opened, so reading costs
    // nothing and a file the user may not read still counts.
    const read = createReadTool(cwd, {
        operations: {access: regularFile, readFile: () => Promise.resolve(Buffer.alloc(0))}
    })

    try {
        await read.execute(stepsLabel, {path}, signal)
        return true
    } catch {
        return false
    }
}

const misplaced = async (
    cwd: string,
    files: PlanFile[],
    signal: AbortSignal | undefined
): Promise<PlanFile | undefined> => {
    const there = await Promise.all(files.map(file => onDisk(cwd, file.path, signal)))

    // An aborted read fails like a missing file, so its answer says nothing about the disk.
    if (signal?.aborted) return undefined
    return files.find((file, index) => there[index] !== (file.state === 'existing'))
}

const sendBackSteps =
    (cwd: string, signal: AbortSignal | undefined): SendBack =>
    async answer => {
        const plan = parseSteps(answer)

        if (plan === undefined) return layoutNote

        const wrong = await misplaced(cwd, plan.files, signal)
        return wrong === undefined ? undefined : misplacedNotes[wrong.state](wrong.path)
    }

// No label for an empty list: a plan saved before the part hands over as it did.
const verifyText = (verify: string[]): string[] =>
    verify.length === 0 ? [] : [verifyLabel, ...verify.map(command => `- ${command}`)]

const stepsText = ({steps, files, verify}: Steps): string => {
    if (steps.length === 0) return ''
    return [
        stepsLabel,
        ...steps.map((step, index) => `${String(index + 1)}. ${step}`),
        filesLabel,
        ...files.map(({path, state}) => `- ${path} (${state})`),
        ...verifyText(verify)
    ].join('\n')
}

// parseSteps refuses text with no VERIFY label, so an edit keeps it even with no command.
const editText = (plan: Steps): string =>
    plan.verify.length === 0 ? `${stepsText(plan)}\n${verifyLabel}` : stepsText(plan)

/** head is what a fresh session must be told first; a session that knows the goal gets none. */
const stepsTask = (head: string[], current: Steps, change?: string): string => {
    const asked = change === undefined ? [] : [goalTask({change})]
    const known =
        head.length === 0 || change === undefined ? [] : [currentLabel, stepsText(current)]
    const lead = [...head, ...known, ...asked]

    if (lead.length === 0) return stepsRules
    return [...lead, '', stepsRules].join('\n')
}

export {
    editText,
    layoutNote,
    misplaced,
    parseSteps,
    sendBackSteps,
    stepsLayout,
    stepsRules,
    stepsTask,
    stepsText
}
export type {PlanFile, Steps}
