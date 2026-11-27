// pi loads extensions under Node through jiti, while bun test runs Bun. This reads PDFs the way pi does.
import {strict as assert} from 'node:assert'
import {readFileSync} from 'node:fs'
import {createJiti} from 'jiti'

const {pdfText} = await createJiti(import.meta.url, {moduleCache: false}).import(
    '../../src/subagent/fetch/pdf.ts'
)
const fixture = name => readFileSync(new URL(`../subagent/fetch/fixtures/${name}.pdf`, import.meta.url))
const limit = 10 * 1024 * 1024

assert.equal(await pdfText(fixture('two-pages'), limit), 'First page text\n\nSecond page text')
// Needs the vendored CMaps, found next to pdf.ts.
assert.equal(await pdfText(fixture('sjis-noembed'), limit), 'あいうえお')
await assert.rejects(pdfText(fixture('one-page-bomb'), 100_000), /page too big/)

console.log(`node ${process.version}: pdf pass`)
