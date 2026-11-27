import {afterAll, beforeAll, mock} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import {join} from 'node:path'

import {tempRoot} from './tree'

// bun's mock.module is process-wide, so every test file that fakes getAgentDir must agree on it.
// A space and an & in the path, which cmd.exe must not split on when npm packs into it.
const agentDir = mkdtempSync(join(tempRoot, 'pi nop & test '))
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
