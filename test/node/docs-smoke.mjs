// pi loads extensions under Node through jiti, while bun test runs Bun. This runs the npm path the way pi does.
import {strict as assert} from 'node:assert'
import {existsSync, mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createJiti} from 'jiti'

const agentDir = mkdtempSync(join(realpathSync(tmpdir()), 'pi nop & smoke '))
process.env.PI_CODING_AGENT_DIR = agentDir
const {download, view} = await createJiti(import.meta.url).import('../../src/subagent/docs/npm.ts')
const cwd = process.cwd()

try {
    const ranged = await view({name: 'typescript', spec: '>=5.0.0 <5.1.0'}, cwd)
    assert.match(ranged.version, /^5\.0\./)
    assert.equal((await view({name: 'zod', spec: '3.22.0 || 3.22.4'}, cwd)).version, '3.22.4')

    const zod = await download('zod', {name: 'zod', spec: '^3'}, cwd)
    assert.ok(existsSync(join(zod, 'node_modules', 'zod', 'package.json')))

    // Its tarball's top folder is node/, not package/.
    const types = await download('@types/node', {name: '@types/node', spec: '22.10.0'}, cwd)
    assert.ok(existsSync(join(types, 'node_modules', '@types', 'node', 'index.d.ts')))
} finally {
    rmSync(agentDir, {recursive: true, force: true})
}

console.log(`node ${process.version}: view and download pass`)
