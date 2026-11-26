<div align="center">

![pi-nop. Read-only subagents for pi. Four tools search the repo, read a page or PDF, read an npm package and search the web. The /plan panel goes from goal to questions to steps, then hands the plan to the main agent.](https://cdn.jsdelivr.net/npm/pi-nop/assets/hero.svg)

# pi-nop

**Read-only subagents for [pi](https://pi.dev): repo search, web page and PDF fetch, npm package
docs, web search, and a `/plan` panel.**

[![npm](https://img.shields.io/npm/v/pi-nop?color=cb3837&logo=npm)](https://www.npmjs.com/package/pi-nop)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![pi extension](https://img.shields.io/badge/pi-extension-7c3aed)](https://pi.dev/packages)
[![tests](https://img.shields.io/badge/tests-830%20passing-3fb950)](#development)
[![types](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](#development)

</div>

## What it does

A main agent that reads a big file, a web page or a package's types fills its context with text
it needs once. pi-nop gives that work to a subagent. The subagent runs in its own session, reads
what it needs, and sends back only the answer.

`/plan` uses the same subagent to turn a request into a plan. It writes a goal, asks you
questions, then writes the steps, the files and the test commands. The main agent gets the plan
and builds it. The footer shows how many plan files it has written.

## Why it's different

- **Read-only.** The repo subagent can read, grep, find and ls. No subagent can edit, write or
  run commands.
- **Built for local models.** Guards catch a model that loops, stalls, re-reads or leaks tool
  markup, and run it again with a note on what went wrong.
- **Measured.** Tool wording and plan layout were tested on Gemma 12B and Qwen 3.8 before they
  shipped.
- **One model per tool.** Each tool can run on its own model and thinking level, so a small fast
  model can do the reading.
- **Plans with checks.** Each plan file is checked against the disk before hand over. Then each
  write is tracked against the plan.

## Install

```bash
pi install npm:pi-nop
```

### Requirements

- pi. Built against 1.0.0, smoke tested on 1.6.0.
- `npm` and `tar` on PATH, for `subagent-docs`.
- poppler's `pdftotext` with the `-remove-hyphens` option, for PDFs in `subagent-fetch`. See
  [Fetch PDFs](#fetch-pdfs).

## Quickstart

The main agent picks the tools by itself. Ask it as you normally would:

```
Where is the session file written? Use a subagent.
What does the retry option of p-retry do?
Read https://example.com/changelog and tell me what changed in 2.0.
```

Plan a change in the panel, then send it to the main agent:

```
/plan add rate limiting to the upload endpoint
```

Run the reading on a smaller model:

```
/nop-config
```

## Commands

| Command | What it does |
|---|---|
| `/plan [request]` | Open the planning panel. Text after the command is sent as the request. Needs the interactive UI. |
| `/nop-config` | Open the config panel. See [Config](#config). |

## Tools

- `subagent`: a read-only subagent searches the repo and returns only its answer.
- `subagent-fetch`: reads one web page or PDF and answers a query about it.
- `subagent-docs`: answers from an npm package's types and README, installed or downloaded. It
  needs `npm` and `tar` on PATH.
- `web-search`: up to 10 results from the `web-search.engine`. `exa` and `ddg` need no key, `brave`
  needs `BRAVE_SEARCH_API_KEY`. `PI_NOP_SEARCH_ENGINE` overrides the engine and
  `PI_NOP_SEARCH_ENDPOINT` its URL.

A download has no deadline of its own, and Esc stops it. Measured on node 24, a server that sends
nothing fails the call after 300 seconds. npm on a registry that never answers gave up after 970
seconds. A server that keeps sending a byte now and then is stopped only by Esc.

## Config

`/nop-config` opens the panel. The file is `~/.pi/agent/pi-nop.json`.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `subagent`, `subagent-fetch`, `subagent-docs` | `{model, thinkingLevel}` | the host's | Model and thinking level per tool. `/plan` runs on the `subagent` row. |
| `web-search.engine` | `exa`, `brave`, `ddg` | `exa` | Search engine. |
| `concurrency` | 1 to 4 | unlimited | Subagents running at once. |
| `staleMinutes` | `off`, 5, 10, 20, 30 | 10 | Kill a run when the model sends nothing for this long. |
| `toolCallMinutes` | `off`, 5, 10, 15, 30 | 15 | Kill a run when one read, grep, find or ls does not return in this time. |
| `restarts` | 0 to 3 | 2 | How many times a run goes again, after a kill or after `/plan` sends a goal or steps answer back. 0 keeps the guards, fails on the first kill and sends nothing back. |

A saved model that pi no longer lists runs on the host model, with a warning on each call. The
open `/plan` panel holds the keys, so its model changes only through an edit of the config file
or a model pi drops. The next turn then runs in a fresh session.

### Guards

Every subagent run is watched. A guard that trips aborts the run, drops that attempt's messages,
and prompts again with a note on what went wrong. A kill past the `restarts` budget fails the tool
call with `Subagent killed by the guard: <name>`.

The goal turn of `/plan` uses the same budget. While it lasts, a finished reply with no `GOAL:` line
is sent back to the model with a note, in the same conversation. After that the panel shows the
error with a "Try again" row, and typed text is a new request. A reply that failed or was cut off
at the output limit is not sent back.

The steps turn of `/plan` does the same for a reply that is not in the `STEPS:`, `FILES:` and
`VERIFY:` layout, or that tags a file `existing` when no regular file is at that path, or `new`
when one is. One note names one file, so two wrong files cost two of the budget. With `restarts`
at 0 such a reply fails the turn. The steps turn runs without the `ask_user` tool.

- **loop**: the same tool call five times in the last twenty, or one file re-read five times
  without reaching new lines. The note names the call and lists what the attempt had read.
- **stale**: no event from the model for `staleMinutes`. The clock pauses while a tool call runs
  and while pi waits to retry a failed request. A long prompt on a local model counts, so keep
  `staleMinutes` above the model's slowest prefill.
- **tool-call**: one read, grep, find or ls past `toolCallMinutes`. With this `off`, a hung tool
  call is not watched at all, since the stale clock pauses during it.
- **ground**: eight tool calls in a row that were repeats or errors.
- **churn**: tool results past twice the context window. A local server drops old context
  silently, so this is the model re-reading what it lost.
- **leak**: the final answer holds `<tool_call>` or `<function=…>` markup instead of a tool call.
- **repeat**: one thinking or answer block ends on the same run of lines eight times in a row.
  A model that loops there makes no tool call, so nothing else stops it before the output limit.
  One line repeated on its own is not a hit, and neither is a loop with no line break in it.
- **circle**: one thinking block says two different sentences eight times each, with any lines
  between. A loop where one line changes each round is caught here, before it repeats a whole
  block. A line counts when it starts with a letter and ends with `.`, `!` or `?`, so drafted
  code and list rows do not.

## Fetch PDFs

`subagent-fetch` reads a PDF through poppler's `pdftotext`. It must be on PATH and know the
`-remove-hyphens` option, which Debian 13's poppler 25.03 lacks. `application/pdf` and the
aliases shared-mime-info lists (`application/x-pdf`, `application/acrobat`, `application/nappdf`,
`image/pdf`) are read as a PDF. With no type or `application/octet-stream`, a body with `%PDF-`
in its first 1024 bytes and `%%EOF` in its last 1024 is too. A hyphen at a line end stays, so a
part number split there is not joined. A quote may still join the split, even across a page
break with no footer between the halves. Each split in a quote may keep its hyphen, keep it with a space, or between letters drop
it, so one quote can hold a compound and a split word. A body served as a PDF with no `%PDF-` in
its first 1024 bytes, a password protected PDF, or a PDF with no text layer, such as a scan,
fails the call.

## Plan

`/plan` opens a panel over the chat. The strip at the top shows four steps.

1. **Goal.** Type what you want done. The subagent reads the repo and writes a `GOAL:` line. Type
   again to change it, or pick "Accept the goal".
2. **Questions.** The subagent asks one question at a time, with numbered options. Pick one or
   type your own answer. "Finish questions" stops early.
3. **Steps.** "Plan steps" writes the `STEPS:`, `FILES:` and `VERIFY:` parts. Each file is tagged
   `existing` or `new`. Type a change, or pick "Edit plan" to change it by hand.
4. **Hand over.** "Send to main context" closes the panel and sends the plan to the main agent.
   `/plan` then tracks it. See [Plan tracking](#plan-tracking).

"Send to main context" is there from the goal on, so a small change can skip the questions.
"Change goal" goes back to step 1 and keeps the goal text. Esc before hand over asks first, since
a running subagent stops.

## Plan verify part

A row under `VERIFY:` in the steps reply is a command for the main agent to run when the steps are
done, with or without a dash. A bare dash or `none` is no command. A row with no dash beside rows
with one is sent back as a bad layout. A row that is only a closing tag, like `</parameter>`, is
dropped. The command is not checked and `/plan` never runs it. Hand over sends it after the files.
The panel keeps it whole while steps and files shrink to counts. On a screen too short even for
that, the panel is cut from the top.

## Plan edit

"Edit plan" opens the steps, files and commands in pi's editor before hand over. Ctrl+G there opens
your external editor. The edit goes through the same checks as the steps reply: the layout, and
each file tag against the disk. A refused edit comes back with your text and the reason in the
title. Esc or an empty text drops it. A saved edit ends the planning session, so a later change
starts a fresh one that gets the edited steps.

## Plan tracking

After hand over of a plan with steps `/plan` tracks it. The footer shows `plan: files 3/4 · outside
1`: how many of the plan's files the main agent called `edit` or `write` on, and how many other
files. `/plan` opens the plan with a mark on each file and step. A step is done when every plan file
it names was written, and has a dot when it names none. A row that is a folder is written once a
file inside it is. A plan file a command changed counts too, by its last write time and size
against hand over: `bun add` and `package.json`. The count runs when an `edit`, `write` or `bash`
call ends. "Stop tracking" or a new plan ends it. Not seen: a write through bash or a codemode
script to a file outside the plan. For a folder row a command counts only when it adds, removes
or renames an entry right inside the folder.

## Plan changes

A typed change to the steps goes to the main agent with the plan, one `Change asked by the user:`
line each after the steps. The goal was written before the change, and without the line the main
agent followed the goal. A new goal or "Change goal" drops the lines. An edit keeps them, so an
edit that undoes a typed change loses to the change line. A typed change that fails, or a goal
change with no `GOAL:` line, offers "Try again" with the same text.

## Environment

| Variable | Used by | Meaning |
|---|---|---|
| `BRAVE_SEARCH_API_KEY` | `web-search` | Needed only when the engine is `brave`. |
| `PI_NOP_SEARCH_ENGINE` | `web-search` | Overrides `web-search.engine` from the config. |
| `PI_NOP_SEARCH_ENDPOINT` | `web-search` | Overrides the engine's URL. |

## Development

```bash
bun install
bun test               # 830 tests across 44 files
npm run lint           # prettier, eslint and tsc, with fixes
npm run lint:check     # the same, no fixes
```

The `eval` scripts run the tools against a live model. Built with [Bun](https://bun.sh),
TypeScript strict and [TypeBox](https://github.com/sinclairzx81/typebox) for tool schemas.

## License

[MIT](./LICENSE) © Edgars Mjasnikovs
