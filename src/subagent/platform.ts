import {spawn} from 'node:child_process'
import type {ChildProcess} from 'node:child_process'
import {existsSync} from 'node:fs'
import {delimiter, isAbsolute, join} from 'node:path'

// pi falls back the same way when SystemRoot is unset.
const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
// Git for Windows puts GNU tar on PATH, which reads C:\ as a remote host. System32 has bsdtar.
const tar = process.platform === 'win32' ? join(system32, 'tar.exe') : 'tar'
const notFound = (command: string): string => `${command} was not found`

// A spawn in a folder that is gone fails with ENOENT too, and that is not a missing command.
const missing = (command: string, error: unknown, cwd?: string): unknown =>
    isNotFound(error) && (cwd === undefined || existsSync(cwd)) ?
        new Error(notFound(command))
    :   error

const isNotFound = (error: unknown): boolean =>
    error instanceof Error && 'code' in error && error.code === 'ENOENT'

// On Windows which, libuv and cmd.exe search the current folder first, so a repo's own copy would run.
const onPath = (name: string, runnable = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'): string => {
    if (process.platform !== 'win32' || isAbsolute(name)) return name

    // Windows allows a quoted PATH entry, and which reads it the same way.
    const dirs = (process.env.PATH ?? '')
        .split(delimiter)
        .map(dir => dir.replace(/^"(.*)"$/, '$1'))
        .filter(dir => isAbsolute(dir))
    // An empty PATHEXT entry would match Node's extensionless npm shell script.
    const extensions = runnable.split(delimiter).filter(extension => extension !== '')
    const found = dirs
        .flatMap(dir => extensions.map(extension => join(dir, name + extension)))
        .find(file => existsSync(file))

    if (found === undefined) throw Object.assign(new Error(notFound(name)), {code: 'ENOENT'})
    return found
}

// cmd.exe looks for a bare command, like the node an upgraded npm.cmd calls, in the current folder first.
const childEnv = (): NodeJS.ProcessEnv => ({
    ...process.env,
    NoDefaultCurrentDirectoryInExePath: '1'
})

// cross-spawn runs npm.cmd under cmd.exe, and killing cmd.exe alone leaves npm running.
const stop = (child: ChildProcess): void => {
    if (process.platform !== 'win32' || child.pid === undefined) {
        child.kill()
        return
    }

    spawn(join(system32, 'taskkill.exe'), ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore'
    })
        .once('error', () => child.kill())
        .once('exit', code => code === 0 || child.kill())
}

export {childEnv, missing, onPath, stop, tar}
