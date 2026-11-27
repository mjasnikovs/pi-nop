// Windows has no FIFO files. Git's MSYS mkfifo fakes one, and the test run hung on it.
const noFifo = process.platform === 'win32' || Bun.which('mkfifo') === null

export {noFifo}
