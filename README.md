<div align="center">

![pi-nop. Read-only subagents for pi. Subagents read in their own session and only the answer comes back. Tools: subagent answers about the repo, fetch answers from one web page, docs answers from an npm package, search gives up to 10 web results. /plan: goal, questions, steps, then the plan is sent to the main agent.](https://raw.githubusercontent.com/mjasnikovs/pi-nop/master/assets/hero.svg)

# pi-nop

**Read-only subagents for [pi](https://pi.dev): repo search, web fetch, npm package docs, web
search, and a `/plan` panel.**

[![npm](https://img.shields.io/npm/v/pi-nop?color=cb3837&logo=npm)](https://www.npmjs.com/package/pi-nop)
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
pi install npm:pi-nop
```

Needs pi 1.6.0 or later. `subagent-docs` needs `npm` and `tar` on PATH.

## Tools

The main agent calls these on its own. Name a tool in your prompt to make it use one.

| Tool | What it returns |
|---|---|
| `subagent` | An answer about the repo. The subagent reads with read, grep, find and ls. |
| `subagent-fetch` | What a query asks for from one web page, not the page. |
| `subagent-docs` | An answer from an npm package's types and README, with the latest version. Reads the installed copy, or downloads one. |
| `web-search` | Up to 10 results with title, URL and snippet. `exa` and `ddg` need no key. `brave` needs `BRAVE_SEARCH_API_KEY`. |

## Plan

`/plan [request]` opens a panel with four steps.

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
| `restarts` | 0 to 3 | 2 | How many times a killed run goes again. |

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
bun test
npm run lint
```

## License

[MIT](./LICENSE) © Edgars Mjasnikovs
