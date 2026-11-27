# Where this stopped (2026-11-27)

## Done and released

- **0.1.2 on npm**, tag `v0.1.2`, PR #1 merged. It runs on Windows and macOS, with CI on all three OSes.
- **CI**: lint, `bun run test` at 100% coverage, and the Node smoke `test/node/docs-smoke.mjs`.
  Bun is pinned to 1.4.5, because 1.3.14 hangs on Windows. Upgrade your local bun to 1.4.5.
- **PDF findings**: in `PDF.md`. Nothing is planned yet.

## In progress: PR #2, branch `ux-fixes` (not merged, not released)

These four annoyances are fixed, with tests that failed first and mutation checks:

1. **Broken config warning**: it names the file and what is wrong: bad JSON, the key and its
   value, an unknown key, a flat `subagent.model`, a list or object value, or a file it cannot
   read. A file with a byte order mark reads fine.
2. **`/nop-config` save**: it reads the file before every save. Edits made meanwhile are kept. A
   broken file is copied aside as `pi-nop.json.broken` (or `-2` and on), and a symlink stays a
   link. A failed save is shown as an error.
3. **Answer layout**: labels may be dressed as `**COVERED:**`, `` `ANSWER` ``, `## COVERED:` or
   `- ANSWER:`, in any case. `Yes.` and `**yes**` count, and a hedged `no, partially` fails closed.
   The reply may be wrapped in a fence. The divider rule is settled: the first `EVIDENCE` in capitals.
   The reasons are in the memory note `answer-divider-rule`.
4. **`PI_NOP_SEARCH_ENGINE`**: an unknown value names itself and the engines. An empty value
   counts as unset.

Review loop: 7 rounds so far. Round 7 fixes are committed.

## Next steps

1. Commit the save-failure test fix (read-only file, the swap mutant is now caught) and check CI.
2. Run `/code-review master` again, and loop until a round finds only speculation.
3. Merge PR #2 (rebase), bump to 0.1.3, push master, wait for master CI, then `npm publish --access public`,
   tag `v0.1.3`, and run the `pi install` check. Steps are in the memory note `npm-release-how`.

## Left as speculation or decided (do not reopen without new data)

- **cross-spawn as a dependency**: you approved it.
- **`platform.ts` skipped in coverage**: Windows-only branches.
- **Title case `Evidence:` divider**: rejected, as on master. See `answer-divider-rule`.
- **Speculation, not fixed**: a missing ComSpec, `npm pack` non-JSON stdout (probed: always JSON),
  the config re-read race, long string values in the warning, piled `.broken` copies on a
  read-only file, a fence line with a made-up language, closing markup on
  `**ANSWER: x**`, a fence-only answer, an empty key name, tests run as root.

## Not started (from the annoyance scan, older than this work)

- The broken-config warning shows on every tool call, not once.
- `"thinkingLevel": "inherit"` and `"concurrency": "unlimited"`, as the panel prints them, break the file.
- `/plan` drops the reason for "no steps that pass the checks".
- With `concurrency: 1`, a `/plan` question blocks every subagent tool.
- The model picker hides models outside the session scope.
- `subagent-fetch` sends no browser User-Agent.
- The docs cache never cleans up, and ranges download again on every call.
- `{"guards": {...}}`, copied from the panel's section names, gets no hint to move to the top level.
- The rest of the 22-item scan: error prefixes and tone, too-big messages, guard-kill hints,
  README drift, and the `subagent` description promising shell output.
