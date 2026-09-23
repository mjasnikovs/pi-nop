import type {Run} from './pi'

type Check = {
    name: string
    ok: boolean
}

type Case = {
    name: string
    prompt: string
    checks: (run: Run) => Check[]
}

const check = (name: string, ok: boolean): Check => ({name, ok})

const failures = (checks: Check[]): string[] =>
    checks.filter(item => !item.ok).map(item => item.name)

export {check, failures}
export type {Case, Check}
