const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value === null || typeof value !== 'object') return value
    const entries = Object.entries(value as Record<string, unknown>)
    entries.sort(([a], [b]) => a.localeCompare(b))
    return Object.fromEntries(entries.map(([name, inner]) => [name, canonical(inner)]))
}

// A model sends the same args in a different key order from one call to the next.
const callKey = (name: string, args: unknown): string =>
    `${name} ${JSON.stringify(canonical(args))}`

export {callKey}
