// The subagent answers in a fixed layout so the tool can check it instead of trusting it.
const answerPrompt = [
    'Answer the query using only the page text.',
    'Reply in exactly this layout and nothing else. No code fence around it.',
    'COVERED: yes, partial or no. partial when the page answers only some of the query.',
    'ANSWER:',
    'the answer, any length. When COVERED is partial or no, say what is missing and what the page holds instead.',
    'If the page states when it was written or updated, include that.',
    'EVIDENCE:',
    'one page line per line, every line the answer rests on, copied exactly, character for character.',
    'At least one line when COVERED is yes or partial. Nothing when COVERED is no and there is nothing to cite.'
].join('\n')

const coverages = ['yes', 'partial', 'no'] as const
type Coverage = (typeof coverages)[number]

type Answer = {
    covered: Coverage
    answer: string
    evidence: string[]
}

const isCoverage = (value: string): value is Coverage =>
    (coverages as readonly string[]).includes(value)

const labelled = (line: string | undefined, label: string): string | undefined =>
    line?.startsWith(label) ? line.slice(label.length).trim() : undefined

// Labels are found on trimmed lines, but the answer keeps its raw lines: blank lines and
// indentation are part of a copied code block.
const parseAnswer = (text: string): Answer | undefined => {
    const lines = text.replaceAll('\r\n', '\n').split('\n')
    const trimmed = lines.map(line => line.trim())
    const coveredAt = trimmed.findIndex(line => line !== '')
    const answerAt = trimmed.findIndex((line, index) => index > coveredAt && line !== '')
    const divider = trimmed.findIndex(
        (line, index) => index > answerAt && line.startsWith('EVIDENCE:')
    )
    const covered = labelled(trimmed[coveredAt], 'COVERED:')?.toLowerCase()
    const first = labelled(trimmed[answerAt], 'ANSWER:')

    if (covered === undefined || !isCoverage(covered)) return undefined
    if (first === undefined || divider === -1) return undefined

    const answer = [first, ...lines.slice(answerAt + 1, divider)].join('\n').trim()

    if (answer === '') return undefined

    const evidence = [labelled(trimmed[divider], 'EVIDENCE:') ?? '', ...trimmed.slice(divider + 1)]
    return {covered, answer, evidence: evidence.filter(line => line !== '')}
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

const notOnPage = (answer: Answer, page: string): string[] => {
    const flat = squash(page)
    return answer.evidence.filter(line => !flat.includes(squash(line)))
}

export {answerPrompt, notOnPage, parseAnswer}
export type {Answer, Coverage}
