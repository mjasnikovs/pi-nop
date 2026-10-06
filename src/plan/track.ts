import {stat} from 'node:fs/promises'
import {relative, sep} from 'node:path'

import {createReadTool} from '@earendil-works/pi-coding-agent'
import type {SessionEntry} from '@earendil-works/pi-coding-agent'

import type {Steps} from './steps'

const writeTools = new Set(['edit', 'write'])
// A command can change a plan file with no edit or write call: `bun add` writes package.json.
const diskTools = new Set([...writeTools, 'bash'])
const resolveLabel = 'plan-track'

type StepMark = 'done' | 'open' | 'untracked'
type Progress = {
    /** One per FILES row, in order. */
    files: boolean[]
    steps: StepMark[]
    outside: string[]
    written: number
    total: number
}

// A failed call counts: a write aborted after it reached the disk still reports an error.
const writes = (entries: SessionEntry[]): string[] => [
    ...new Set(
        entries.flatMap(entry => {
            if (entry.type !== 'message' || entry.message.role !== 'assistant') return []
            return entry.message.content.flatMap(block => {
                if (block.type !== 'toolCall' || !writeTools.has(block.name)) return []

                const path: unknown = block.arguments.path
                return typeof path === 'string' ? [path] : []
            })
        })
    )
]

// pi exports no path resolver. Its read tool hands the resolved path to access.
const resolved = async (cwd: string, path: string): Promise<string> => {
    const found = {path}
    const read = createReadTool(cwd, {
        operations: {
            access: at => {
                found.path = at
                return Promise.reject(new Error(at))
            },
            readFile: () => Promise.resolve(Buffer.alloc(0))
        }
    })
    await read.execute(resolveLabel, {path}, undefined).catch(() => undefined)
    return found.path
}

const stamp = async (path: string): Promise<string> => {
    const found = await stat(path).catch(() => undefined)

    return found === undefined ? '' : `${String(found.mtimeMs)}:${String(found.size)}`
}

/** One per FILES row: what is on disk now. */
const stamps = async (cwd: string, plan: Steps): Promise<string[]> =>
    Promise.all(plan.files.map(async file => stamp(await resolved(cwd, file.path))))

const endsInPath = /[\w./-]$/
const goesOn = /^(?:[\w/-]|\.\w)/

/** True when the step text holds the path whole, not as a piece of a longer path. */
const names = (step: string, path: string): boolean => {
    const parts = step.split(path)

    return parts
        .slice(1)
        .some((after, index) => !endsInPath.test(parts[index] ?? '') && !goesOn.test(after))
}

const stepMark = (written: boolean[]): StepMark => {
    if (written.length === 0) return 'untracked'
    return written.every(Boolean) ? 'done' : 'open'
}

// A FILES row can be a folder, and a file written inside it is that row's work.
const holds = (row: string, path: string): boolean => path === row || path.startsWith(row + sep)

// An entry saved before the stamps has none, and then no row counts as changed.
const changedRows = async (rows: string[], handed: string[]): Promise<string[]> => {
    const now = await Promise.all(handed.map(async (_, index) => stamp(rows[index] ?? '')))

    return rows.filter((_, index) => now[index] !== handed[index])
}

const progress = async (
    cwd: string,
    plan: Steps,
    calls: string[],
    handed: string[] = []
): Promise<Progress> => {
    const [planned, called] = await Promise.all([
        Promise.all(plan.files.map(file => resolved(cwd, file.path))),
        Promise.all(calls.map(path => resolved(cwd, path)))
    ])
    const written = [...new Set(called)]
    const wanted = [...new Set(planned)]
    const changed = await changedRows(planned, handed)
    const done = (row: string): boolean =>
        changed.includes(row) || written.some(path => holds(row, path))
    const files = planned.map(done)

    return {
        files,
        steps: plan.steps.map(step =>
            stepMark(
                plan.files.flatMap((file, index) =>
                    names(step, file.path) ? [files[index] === true] : []
                )
            )
        ),
        outside: written
            .filter(path => !wanted.some(row => holds(row, path)))
            .map(path => relative(cwd, path)),
        written: wanted.filter(done).length,
        total: wanted.length
    }
}

const statusText = ({written, total, outside}: Progress): string => {
    const files = `plan: files ${String(written)}/${String(total)}`

    return outside.length === 0 ? files : `${files} · outside ${String(outside.length)}`
}

export {diskTools, names, progress, stamps, statusText, writes}
export type {Progress, StepMark}
