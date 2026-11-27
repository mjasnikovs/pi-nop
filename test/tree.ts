import {mkdirSync, mkdtempSync, realpathSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

type Files = Record<string, string | object>

// Objects are written as JSON, so a package.json reads as a literal.
const writeTree = (root: string, files: Files): string => {
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), {recursive: true})
        writeFileSync(
            join(root, path),
            typeof content === 'string' ? content : JSON.stringify(content)
        )
    }

    return root
}

// macOS tmpdir is behind a symlink, and the code under test realpaths what it finds.
const tempRoot = realpathSync(tmpdir())
const tempTree = (files: Files): string => writeTree(mkdtempSync(join(tempRoot, 'pi-nop-')), files)

export {tempRoot, tempTree, writeTree}
export type {Files}
