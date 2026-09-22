import {afterAll, beforeAll, mock} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

// bun's mock.module is process-wide, so every test file that fakes getAgentDir must agree on it.
const agentDir = mkdtempSync(join(tmpdir(), 'pi-nop-test-'))
const getAgentDir = mock(() => agentDir)

// Call once per test file: the dir lives for that file and is removed after it.
const useAgentDir = (): void => {
    beforeAll(() => {
        mkdirSync(agentDir, {recursive: true})
    })

    afterAll(() => {
        rmSync(agentDir, {recursive: true, force: true})
    })
}

export {agentDir, getAgentDir, useAgentDir}
