type Layout = {
    /** What the model may read: "page text", "package files". */
    source: string
    /** The thing that covers the query: "page", "package". */
    subject: string
    /** What one evidence line is: "page line", "file line". */
    unit: string
    answerNotes?: string[]
    evidenceNotes?: string[]
}

// The subagent answers in a fixed layout so the tool can check it instead of trusting it.
const layoutPrompt = ({
    source,
    subject,
    unit,
    answerNotes = [],
    evidenceNotes = []
}: Layout): string =>
    [
        `Answer the query using only the ${source}.`,
        'Reply in exactly this layout and nothing else. No code fence around it.',
        `COVERED: yes, partial or no. partial when the ${subject} answers only some of the query.`,
        'ANSWER:',
        `the answer, any length. When COVERED is partial or no, say what is missing and what the ${subject} holds instead.`,
        ...answerNotes,
        'EVIDENCE:',
        [
            `one ${unit} per line, every line the answer rests on, copied exactly, character for character.`,
            ...evidenceNotes
        ].join(' '),
        'At least one line when COVERED is yes or partial. Nothing when COVERED is no and there is nothing to cite.'
    ].join('\n')

enum AnswerErrors {
    Layout = 'Subagent answer failed verification: not in the answer layout',
    NoEvidence = 'Subagent answer failed verification: no evidence for a covered answer',
    Invented = 'Subagent answer failed verification: evidence not in the source: '
}

const coverages = ['yes', 'partial', 'no'] as const
type Coverage = (typeof coverages)[number]

type Answer = {
    covered: Coverage
    answer: string
    evidence: string[]
}

const isCoverage = (value: string): value is Coverage =>
    (coverages as readonly string[]).includes(value)

// A markup run after the colon closes a dressed label, as in **COVERED:**, only before a space.
const labelPattern = (label: string, flags: string): RegExp =>
    new RegExp(`^[*_\`#>\\s-]*${label}[*_\`\\s]*:(?:[*_\`]+(?=\\s|$))?`, flags)

const labelled = (line: string | undefined, label: string, flags = 'i'): string | undefined => {
    if (line === undefined) return undefined

    const found = labelPattern(label, flags).exec(line)
    return found === null ? undefined : line.slice(found[0].length).trim()
}

// A fence tag is one word, as c#, then attributes, as title="a". Other text is a quote. Each
// attribute has one parse only, so a looped line cannot backtrack exponentially.
const fence = /^(?:`{3,}|~{3,})(?:\s*[^\s`~]+)?(?:\s+(?:[\w-]+=(?:"[^"]*"|[^\s"]\S*)|\{[^}]*\}))*$/
const isContent = (line: string): boolean => line !== '' && !fence.test(line)

// Capitals only, so the answer may say Evidence:. The first splits, so no quote hides above it.
const dividerAt = (trimmed: string[], answerAt: number): number =>
    trimmed.findIndex(
        (line, index) => index > answerAt && labelled(line, 'EVIDENCE', '') !== undefined
    )

// `no, partially` is a hedge, and read as no it would need no evidence.
const coverageOf = (line: string | undefined): Coverage | undefined => {
    const said = labelled(line, 'COVERED')?.replace(/[*_`]/g, '').toLowerCase()
    const word = /^([a-z]+)[.!]?$/.exec(said ?? '')?.[1]
    return word !== undefined && isCoverage(word) ? word : undefined
}

// The answer keeps raw lines: blank lines and indentation belong to a copied code block.
const parseAnswer = (text: string): Answer | undefined => {
    const lines = text.replaceAll('\r\n', '\n').split('\n')
    const trimmed = lines.map(line => line.trim())
    const coveredAt = trimmed.findIndex(isContent)
    const answerAt = trimmed.findIndex((line, index) => index > coveredAt && isContent(line))
    const divider = dividerAt(trimmed, answerAt)
    const covered = coverageOf(trimmed[coveredAt])
    const first = labelled(trimmed[answerAt], 'ANSWER')

    if (covered === undefined || first === undefined || divider === -1) return undefined

    const answer = [first, ...lines.slice(answerAt + 1, divider)].join('\n').trim()

    if (answer === '') return undefined

    const evidence = [
        labelled(trimmed[divider], 'EVIDENCE', '') ?? '',
        ...trimmed.slice(divider + 1)
    ]
    return {covered, answer, evidence: evidence.filter(line => line !== '')}
}

// Models drop backticks and emphasis when copying; that is not invention.
const normalize = (text: string): string => text.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim()
// A code line may also lose its comment markers or list marker; the `*` of `/** */` is already gone.
const normalizeLine = (line: string): string =>
    normalize(line)
        .replace(/^\/+\s*/, '')
        .replace(/\s*\/+$/, '')
        .replace(/^(?:[-+]|\d+\.)\s+/, '')

type TextSource = {
    text: string
    /** Code: a quote must be a whole line. `string;` is in every declaration file. Prose: any run. */
    wholeLines: boolean
}

/** A source that matches a quote its own way. It takes the quote normalized. */
type QuoteMatcher = {holds: (prose: string) => boolean}

type Source = TextSource | QuoteMatcher

type Quote = {line: string; prose: string; code: string}

const matcher = (source: Source): ((quote: Quote) => boolean) => {
    if ('holds' in source) return quote => source.holds(quote.prose)

    if (!source.wholeLines) {
        const flat = normalize(source.text)
        return quote => flat.includes(quote.prose)
    }

    const lines = new Set(source.text.split('\n').map(normalizeLine))
    return quote => lines.has(quote.code)
}

const missingFrom = (evidence: string[], sources: Source[]): string[] => {
    let pending: Quote[] = evidence.map(line => ({
        line,
        prose: normalize(line),
        code: normalizeLine(line)
    }))

    for (const source of sources) {
        if (pending.length === 0) break
        const holds = matcher(source)
        pending = pending.filter(quote => !holds(quote))
    }

    return pending.map(({line}) => line)
}

// A fence, even ```ts, a lone `}` or an emphasis-only line claims nothing, so it is dropped.
const substantive = (evidence: string[]): string[] =>
    evidence.filter(line => isContent(line.trim()) && /[\p{L}\p{N}]/u.test(normalize(line)))

// The layout is returned as is, so the caller sees the coverage and the evidence too.
const verifyAnswer = (text: string, sources: Source[]): string => {
    const answer = parseAnswer(text)

    if (answer === undefined) throw new Error(AnswerErrors.Layout)

    const evidence = substantive(answer.evidence)

    if (answer.covered !== 'no' && evidence.length === 0) throw new Error(AnswerErrors.NoEvidence)

    const invented = missingFrom(evidence, sources)

    if (invented.length > 0) throw new Error(AnswerErrors.Invented + invented.join(' | '))
    return text
}

export {AnswerErrors, layoutPrompt, missingFrom, normalize, parseAnswer, substantive, verifyAnswer}
export type {Answer, Coverage, Source, TextSource}
