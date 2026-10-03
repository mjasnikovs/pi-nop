import {relative} from 'node:path'

import {createReadTool} from '@earendil-works/pi-coding-agent'
import type {SessionEntry} from '@earendil-works/pi-coding-agent'

import type {Steps} from './steps'

const writeTools = new Set(['edit', 'write'])
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

const progress = async (cwd: string, plan: Steps, calls: string[]): Promise<Progress> => {
    const [planned, called] = await Promise.all([
        Promise.all(plan.files.map(file => resolved(cwd, file.path))),
        Promise.all(calls.map(path => resolved(cwd, path)))
    ])
    const written = new Set(called)
    const wanted = new Set(planned)
    const files = planned.map(path => written.has(path))

    return {
        files,
        steps: plan.steps.map(step =>
            stepMark(
                plan.files.flatMap((file, index) =>
                    names(step, file.path) ? [files[index] === true] : []
                )
            )
        ),
        outside: [...written].filter(path => !wanted.has(path)).map(path => relative(cwd, path)),
        written: [...wanted].filter(path => written.has(path)).length,
        total: wanted.size
    }
}

const statusText = ({written, total, outside}: Progress): string => {
    const files = `plan: files ${String(written)}/${String(total)}`

    return outside.length === 0 ? files : `${files} · outside ${String(outside.length)}`
}

export {names, progress, statusText, writes, writeTools}
export type {Progress, StepMark}
