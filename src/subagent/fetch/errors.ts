enum FetchErrors {
    Failed = 'Fetch failed: ',
    PageTooBig = 'Fetch failed: page too big for the subagent model context window. Tell the user; no query and no retry can read it',
    NoPdfReader = 'Fetch failed: PDF needs pdftotext (poppler) on PATH',
    OldPdfReader = 'Fetch failed: pdftotext is too old, it needs the -remove-hyphens option of a newer poppler',
    NoTextLayer = 'Fetch failed: PDF has no text layer',
    Locked = 'Fetch failed: PDF is password protected'
}

export {FetchErrors}
