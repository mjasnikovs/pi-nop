// Node wraps network errors as a bare "fetch failed" TypeError with the reason in `cause`.
const describe = (error: unknown): string => {
    if (!(error instanceof Error)) return String(error)
    if (error.cause instanceof Error) return `${error.message}: ${error.cause.message}`
    return error.message
}

export {describe}
