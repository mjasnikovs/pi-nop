import {spawn} from 'node:child_process'
import type {ChildProcess} from 'node:child_process'
import {join} from 'node:path'

// pi falls back the same way when SystemRoot is unset.
const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
// Git for Windows puts GNU tar on PATH, which reads C:\ as a remote host. System32 has bsdtar.
const tar = process.platform === 'win32' ? join(system32, 'tar.exe') : 'tar'

// cross-spawn runs npm.cmd under cmd.exe, and killing cmd.exe alone leaves npm running.
const stop = (child: ChildProcess): void => {
    if (process.platform !== 'win32' || child.pid === undefined) {
        child.kill()
        return
    }

    spawn(join(system32, 'taskkill.exe'), ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore'
    }).once('error', () => child.kill())
}

export {stop, tar}
