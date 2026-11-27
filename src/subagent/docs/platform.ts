import {spawn} from 'node:child_process'
import type {ChildProcess} from 'node:child_process'
import {existsSync} from 'node:fs'
import {delimiter, isAbsolute, join} from 'node:path'

// pi falls back the same way when SystemRoot is unset.
const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
// Git for Windows puts GNU tar on PATH, which reads C:\ as a remote host. System32 has bsdtar.
const tar = process.platform === 'win32' ? join(system32, 'tar.exe') : 'tar'

// On Windows which and cmd.exe search the current folder first, so a repo's own npm.cmd would run.
const onPath = (name: string): string => {
    if (process.platform !== 'win32' || isAbsolute(name)) return name

    const dirs = (process.env.PATH ?? '').split(delimiter).filter(dir => isAbsolute(dir))
    const extensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(delimiter)
    const found = dirs
        .flatMap(dir => extensions.map(extension => join(dir, name + extension)))
        .find(file => existsSync(file))

    if (found === undefined) throw new Error(`${name} is not on PATH`)
    return found
}

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

export {onPath, stop, tar}
