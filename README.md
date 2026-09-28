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
| `restarts` | 0 to 3 | 2 | How many times a killed run starts again. 0 keeps the guards and fails on the first kill. |

### Guards

Every subagent run is watched. A guard that trips aborts the run, drops that attempt's messages,
and prompts again with a note on what went wrong. After `restarts` kills the tool call fails with
`Subagent killed by the guard: <name>`.

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
