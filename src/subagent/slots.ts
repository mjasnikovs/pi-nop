type Slots = {
    setCap: (limit: number) => void
    run: <T>(fn: () => Promise<T>, onWait: () => void) => Promise<T>
}

const createSlots = (): Slots => {
    let cap = Number.POSITIVE_INFINITY
    let active = 0
    const queue: Array<() => void> = []

    const drain = (): void => {
        while (active < cap) {
            const start = queue.shift()
            if (start === undefined) return
            active += 1
            start()
        }
    }

    const release = (): void => {
        active -= 1
        drain()
    }

    return {
        setCap: limit => {
            cap = limit
            drain()
        },
        run: (fn, onWait) =>
            new Promise((resolve, reject) => {
                queue.push(() => void fn().then(resolve, reject).finally(release))
                if (active >= cap) onWait()
                drain()
            })
    }
}

// One gate for every subagent run, so a local model server sees at most `cap` runs at once.
const slots = createSlots()

export {createSlots, slots}
