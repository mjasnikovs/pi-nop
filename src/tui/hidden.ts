import type {OverlayHandle} from '@earendil-works/pi-tui'

const whileHidden = async <T>(
    overlay: OverlayHandle | undefined,
    run: () => Promise<T>
): Promise<T> => {
    overlay?.setHidden(true)

    try {
        return await run()
    } finally {
        overlay?.setHidden(false)
    }
}

export {whileHidden}
