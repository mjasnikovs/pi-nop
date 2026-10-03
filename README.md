# pi-nop

## Config

`/nop-config` opens the panel. The file is `~/.pi/agent/pi-nop.json`.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `subagent`, `subagent-fetch`, `subagent-docs` | `{model, thinkingLevel}` | the host's | Model and thinking level per tool. |
| `web-search.engine` | `exa`, `brave`, `ddg` | `exa` | Search engine. |
| `concurrency` | 1 to 4 | unlimited | Subagents running at once. |
| `staleMinutes` | `off`, 5, 10, 20, 30 | 10 | Kill a run when the model sends nothing for this long. |
| `toolCallMinutes` | `off`, 5, 10, 15, 30 | 15 | Kill a run when one read, grep, find or ls does not return in this time. |
| `restarts` | 0 to 3 | 2 | How many times a run goes again, after a kill or after `/plan` sends a goal or steps answer back. 0 keeps the guards, fails on the first kill and sends nothing back. |

### Guards

Every subagent run is watched. A guard that trips aborts the run, drops that attempt's messages,
and prompts again with a note on what went wrong. A kill past the `restarts` budget fails the tool
call with `Subagent killed by the guard: <name>`.

The goal turn of `/plan` uses the same budget. While it lasts, a finished reply with no `GOAL:` line
is sent back to the model with a note, in the same conversation. After that the panel shows the
error. A reply that failed or was cut off at the output limit is not sent back.

The steps turn of `/plan` does the same for a reply that is not in the `STEPS:` and `FILES:`
layout, or that tags a file `existing` when no regular file is at that path, or `new` when one
is. One note names
one file, so two wrong files cost two of the budget. With `restarts` at 0 such a reply fails the
turn.

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

## Plan tracking

After hand over of a plan with steps `/plan` tracks it. The footer shows `plan: files 3/4 · outside
1`: how many of the plan's files the main agent called `edit` or `write` on, and how many other
files. `/plan` opens the plan with a mark on each file and step. A step is done when every plan file
it names was written, and has a dot when it names none. "Stop tracking" or a new plan ends it. A
write through bash or inside a codemode script is not seen.
