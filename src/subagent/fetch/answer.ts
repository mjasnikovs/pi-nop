// The subagent answers in a fixed layout so the tool can check it instead of trusting it.
const answerPrompt = [
    'Answer the query using only the page text.',
    'Reply in exactly this layout and nothing else. No code fence around it.',
    'COVERED: yes, partial or no. partial when the page answers only some of the query.',
    'ANSWER:',
    'the answer, any length. When COVERED is partial or no, say what is missing.',
    'If the page states when it was written or updated, include that.',
    'EVIDENCE:',
    'one page line per line, the lines the answer rests on, copied exactly, character for character.',
    'Nothing after EVIDENCE: when the page has nothing to cite.'
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

const parseAnswer = (text: string): Answer | undefined => {
    const lines = text.trim().split('\n')
    const covered = labelled(lines[0], 'COVERED:')?.toLowerCase()
    const first = labelled(lines[1], 'ANSWER:')
    const divider = lines.indexOf('EVIDENCE:', 2)

    if (covered === undefined || !isCoverage(covered)) return undefined
    if (first === undefined || divider === -1) return undefined

    const answer = [first, ...lines.slice(2, divider)].join('\n').trim()

    if (answer === '') return undefined

    const evidence = lines
        .slice(divider + 1)
        .map(line => line.trim())
        .filter(line => line !== '')
    return {covered, answer, evidence}
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

const notOnPage = (answer: Answer, page: string): string[] => {
    const flat = squash(page)
    return answer.evidence.filter(line => !flat.includes(squash(line)))
}

export {answerPrompt, notOnPage, parseAnswer}
export type {Answer, Coverage}
