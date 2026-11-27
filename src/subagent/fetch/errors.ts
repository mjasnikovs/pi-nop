enum FetchErrors {
    Failed = 'Fetch failed: ',
    PageTooBig = 'Fetch failed: page too big for the subagent model context window. Tell the user; no query and no retry can read it',
    NoTextLayer = 'Fetch failed: PDF has no text layer',
    Locked = 'Fetch failed: PDF is password protected'
}

export {FetchErrors}
