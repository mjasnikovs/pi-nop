const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const spinnerIntervalMs = 100
const idleTicks = 20

const formatElapsed = (elapsedMs: number): string => {
    const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const clock = `${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

    if (hours === 0) return clock
    return `${String(hours)}:${clock}`
}

// Ticks only while something paints it: after idleTicks unseen ticks the timer parks itself.
class Spinner {
    private timer: ReturnType<typeof setInterval> | undefined
    private missedTicks = 0

    frame = 0
    startedAt: number | undefined

    constructor(private readonly requestRepaint: () => void) {}

    painted() {
        this.missedTicks = 0
    }

    elapsedMs(): number {
        if (this.startedAt === undefined) return 0
        return Date.now() - this.startedAt
    }

    start() {
        if (this.timer !== undefined) return

        const timer = setInterval(() => {
            this.missedTicks += 1

            if (this.missedTicks > idleTicks) {
                this.stop()
                return
            }

            this.frame = (this.frame + 1) % spinnerFrames.length
            this.requestRepaint()
        }, spinnerIntervalMs)
        timer.unref?.()
        this.timer = timer
    }

    isTicking(): boolean {
        return this.timer !== undefined
    }

    stop() {
        if (this.timer === undefined) return

        clearInterval(this.timer)
        this.timer = undefined
    }
}

export {formatElapsed, idleTicks, Spinner, spinnerFrames, spinnerIntervalMs}
