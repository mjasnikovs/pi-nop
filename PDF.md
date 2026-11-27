# PDF without a system pdftotext

`subagent-fetch` reads PDF pages with `pdftotext` from poppler 26.05.0 or later, for
`-remove-hyphens`. The user installs it. These are the findings so far, checked on 2026-11-27. Nothing is
planned or built yet.

## What ships it today

| Where | poppler | Note |
|---|---|---|
| GitHub runner images (Ubuntu 26.04, macOS 26, Windows 2025) | none | Checked their package lists |
| apt (Ubuntu 24.04) | 24.02 | Too old |
| choco | 25.5.0 | Too old |
| Homebrew | 26.11.0 | macOS and Linux |
| conda-forge | 26.11.0 | linux-64, linux-aarch64, osx-64, osx-arm64, win-64. CI installs it from here |

## Bundling the binary

- Poppler is GPL. Shipping its binaries means shipping or offering its source too.
- There are no official static builds for Linux or macOS. We would build and maintain five targets.
- `pdf-poppler` 0.2.3 bundles Windows binaries only, and unpacks to 87.9 MB.
- `node-poppler` 11.0.0 is a 0.2 MB wrapper. It still needs poppler installed.

Not a fit.

## A JS extractor

| Package | Version | License | Unpacked | Dependencies |
|---|---|---|---|---|
| `unpdf` | 2.2.3 | MIT | 3.1 MB | none |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 | 37.6 MB | none |

`unpdf` wraps a serverless build of Mozilla's pdf.js. It runs wherever Node runs, so nothing is needed on PATH.

## Open before choosing it

- pdf.js lays out text differently from pdftotext. `pdf.ts` was tuned on pdftotext output: soft hyphen
  joins, ligature folds, `\f` page breaks and `-eol unix`. Every fixture under
  `test/subagent/fetch/fixtures` needs a side-by-side run.
- Answers are verified by quote, so a layout change can change pass rates. It needs the fetch eval
  (`bun eval/fetch.eval.ts`) on Gemma 12B and Qwen 3.8 against today's numbers.
- Not checked yet: whether `unpdf` text extraction runs under pi's jiti on Node 22.19, and its speed and
  memory on a large PDF next to the 10 MB cap.
- It would be the first dependency of this size. The no-new-dependencies rule needs a yes from the user.
