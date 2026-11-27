<div align="center">

![pi-nop. Your daily driver. Minimal, read-only, guarded. Files, a web page and npm docs go into a guarded subagent. One answer goes back to pi.](https://raw.githubusercontent.com/mjasnikovs/pi-nop/master/assets/hero.svg)

# pi-nop

**Read-only subagents for [pi](https://pi.dev): repo search, web fetch, npm package docs, web
search, and a `/plan` panel.**

[![npm](https://img.shields.io/npm/v/@mjasnikovs/pi-nop?color=cb3837&logo=npm)](https://www.npmjs.com/package/@mjasnikovs/pi-nop)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![pi extension](https://img.shields.io/badge/pi-extension-7c3aed)](https://pi.dev/packages)
[![types](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](#development)

</div>

## What it does

When pi reads a big file, a web page or a package's types, all of that text stays in its
context. pi-nop hands the reading to a subagent with its own session. Only the answer comes back.

No subagent can edit, write or run commands. Each tool can use its own model, so a small local
model can do the reading. Guards stop a run that loops or stalls and start it again. Tested on
Gemma 12B and Qwen 3.8.

## Install

```bash
pi install npm:@mjasnikovs/pi-nop
```

Needs pi 1.6.0 or later. `subagent-docs` needs `npm` on PATH, and `tar` too outside Windows.
Windows 10 1803 and Server 2019 or later ship the `tar.exe` it uses. `subagent-fetch` needs
`pdftotext` from poppler 26.05.0 or later on PATH for PDF pages.

## Tools

The main agent calls these on its own. Name a tool in your prompt to make it use one.

| Tool | What it returns |
|---|---|
| `subagent` | Findings from reading many files, not the files. It uses read, grep, find and ls. |
| `subagent-fetch` | What a query asks for from one web page, not the page. |
| `subagent-docs` | An answer from an npm package's types and README, with the latest version. Reads the installed copy, or downloads one. |
| `web-search` | Up to 10 results with title, URL and snippet. `exa` and `ddg` need no key. `brave` needs `BRAVE_SEARCH_API_KEY`. |

A page or package has to fit in 75% of the subagent model's context window. A bigger one fails
the call. On a small local model, pick a model with a larger window for `subagent-fetch` and
`subagent-docs`.

## Plan

`/plan [request]` opens a panel with four steps. It needs the interactive UI. Plain `/plan`
reopens the current plan. `/plan` with text starts a new one and drops the current one.

1. Goal. The subagent writes one `GOAL:` line. Type to change it, or accept it.
2. Questions. It asks one at a time. Pick an option or type your own answer.
3. Steps. It writes the steps, the files to touch and the test commands. Type a change, or pick
   "Edit plan" to change it by hand.
4. Hand over. "Send to main context" sends the plan to the main agent.

After hand over the footer shows `plan: files 3/4 · outside 1`. That's 3 of 4 plan files written,
and 1 file written outside the plan. Run `/plan` again to see which steps are done.

## Config

`/nop-config` opens the panel. The file is `~/.pi/agent/pi-nop.json`.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `subagent`, `subagent-fetch`, `subagent-docs` | `{model, thinkingLevel}` | pi's current one | Model per tool. `/plan` uses the `subagent` one. |
| `web-search.engine` | `exa`, `brave`, `ddg` | `exa` | Search engine. |
| `concurrency` | 1 to 4 | unlimited | Subagents running at once. |
| `staleMinutes` | `off`, 5, 10, 20, 30 | 10 | Kill a run when the model sends nothing this long. |
| `toolCallMinutes` | `off`, 5, 10, 15, 30 | 15 | Kill a run when one tool call takes this long. |
| `restarts` | 0 to 3 | 2 | How many times a killed run goes again. Also how often `/plan` sends a bad answer back. |

```json
{
    "subagent": {"model": "llama-server/qwen3.8", "thinkingLevel": "low"},
    "web-search": {"engine": "ddg"},
    "restarts": 1
}
```

`model` is `provider/id`, as pi lists it. `thinkingLevel` is `off`, `minimal`, `low`, `medium`,
`high`, `xhigh` or `max`. One unknown key or bad value makes pi-nop ignore the whole file, with a
warning that names it. The first `/nop-config` change then saves the old file as
`pi-nop.json.broken`, or `.broken-2` and on when older copies are there. A model pi no longer
lists falls back to pi's current one, with a warning.

`PI_NOP_SEARCH_ENGINE` overrides the engine. `PI_NOP_SEARCH_ENDPOINT` overrides its URL.

### Guards

A guard that trips kills the run and starts it again with a note. Past `restarts` the run fails.

| Guard | Trips on |
|---|---|
| loop | The same tool call five times in twenty, or one file re-read five times with no new lines. |
| stale | No output for `staleMinutes`. The clock pauses while a tool runs. |
| tool-call | One tool call past `toolCallMinutes`. |
| ground | Eight tool calls in a row that repeat or fail. |
| churn | Tool results past twice the context window. |
| leak | Tool call markup in the final answer. |
| repeat | The same block of lines eight times in a row. One line alone does not count. |
| circle | Two sentences said eight times each in one thinking block. |

## Development

```bash
bun install
bun run test
npm run lint
```

## License

[MIT](./LICENSE) © Edgars Mjasnikovs
