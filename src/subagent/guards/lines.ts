type LineReader = {
    /** The trimmed, non-blank lines the delta finished. A line with no line break yet waits. */
    take: (delta: string) => string[]
    reset: () => void
}

const createLineReader = (): LineReader => {
    let open = ''

    return {
        take: delta => {
            const rows = delta.split('\n')
            rows[0] = open + (rows[0] ?? '')
            open = rows.pop() ?? ''
            return rows.map(row => row.trim()).filter(row => row !== '')
        },
        reset: () => {
            open = ''
        }
    }
}

export {createLineReader}
export type {LineReader}
