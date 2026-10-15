// An old pdftotext has no -remove-hyphens, and the PDF code reports it as too old.
const pdftotextReady =
    Bun.which('pdftotext') !== null
    && Bun.spawnSync(['pdftotext', '-h']).stderr.toString().includes('-remove-hyphens')

export {pdftotextReady}
