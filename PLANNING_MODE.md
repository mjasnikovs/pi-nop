# Planning mode for pi-nop

Target: a local model. Qwen 3.8 27B is the daily model, Gemma 4 12B is the floor. Every claim
here is sourced or measured. Measured rows come from 2026-09-27, 10 runs per cell, pi 0.86.1 in
`-p --mode json` on a three-file fixture repo. Harness: `harness/` in the repo root, gitignored,
rebuilt 2026-09-27 on pi 0.87.1. See `harness/README.md`.

## 1. What the two references do

### Claude Code plan mode

Sources: code.claude.com/docs/en/permission-modes, /common-workflows, /settings-reference,
/hooks, /sub-agents, /tools-reference, the CHANGELOG. Lines marked "leak" come from the Piebald
system-prompt dump and are not official.

- Enter: Shift+Tab cycle, `claude --permission-mode plan`, `/plan [task]`, or the model calls
  `EnterPlanMode` itself. Entering asks no permission since 2.1.0.
- Exit: the model calls `ExitPlanMode`. The user picks: approve and auto-accept edits, approve
  and confirm each edit, or "No, keep planning" with feedback text. Ctrl+G opens the plan in an
  editor first. Shift+Tab leaves without approving.
- The restriction is the permission system, not the prompt. Edit and Write are never
  auto-approved in plan mode, even with a matching allow rule (fix 2.1.136). Bash that changes
  files, like `touch` or `rm`, prompts too (fix 2.1.212). Read-only bash runs freely.
- One writable file: the plan file under `~/.claude/plans/` (setting `plansDirectory`), named
  from the prompt. `ExitPlanMode` takes no plan text. It reads the file. Hooks get `plan` and
  `planFilePath`.
- Leak: the turn may only end with `AskUserQuestion` or `ExitPlanMode`. "Is this plan okay?" in
  prose is a violation. Phases: understand, design, review, final plan. The final plan opens with
  Context, gives one recommended approach, names critical files and code to reuse, and ends with
  a verification section.
- Approval injects the whole plan text into the next turn as "Approved Plan". An optional
  clear-context choice starts fresh from the plan alone. After compaction the plan is re-read
  from disk.
- A built-in read-only `Plan` subagent exists. Write and Edit are denied. It inherits the model.
- The `opusplan` alias plans on opus and executes on sonnet.

### superpowers (obra/superpowers, main branch, read 2026-09-27)

- Forcing: a SessionStart hook on startup, clear and compact injects the whole
  `using-superpowers` skill. "If you think there is even a 1% chance a skill might apply ... you
  ABSOLUTELY MUST invoke the skill." "Before entering plan mode: if you haven't already
  brainstormed, invoke the brainstorming skill first."
- brainstorming: classify the work out loud as spike, bounded, or architectural. Ties go to the
  heavier path. Never downgrade mid-task. "Only one question per message." "Prefer multiple
  choice questions." Write back your understanding, split into what the user said and what you
  assumed. Propose 2-3 approaches, recommendation first. Present the design in sections and get
  approval after each. Write the spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`,
  commit, self-review for TBD and ambiguity, then hand to writing-plans. HARD-GATE: no product
  code before approval.
- writing-plans: plan to `docs/superpowers/plans/YYYY-MM-DD-<name>.md`, written for an engineer
  who has never seen the repo. Header: Goal, Architecture, Tech Stack, Spec path, Global
  Constraints, Review Focus (five failure modes, each owned by a task). Each task: Files
  (Create / Modify `path:123-145` / Test), Interfaces (Consumes / Produces with signatures), and
  checkbox steps: failing test, run with `Expected: FAIL`, implement, run with `Expected: PASS`,
  commit. Signatures not bodies. Banned words: "TBD", "handle edge cases". "A plan longer than
  the code it describes has written the code instead."
- executing-plans: run every task without stopping. A deviation becomes a ledger line
  `Ruling: what — why — cost if wrong`. Only four things stop the run: a destructive action, a
  security-sensitive action, an outside side effect, or a plan too broken to follow. A script
  runs the tests and writes `Task N: complete (...)` only on pass. "A failing run records
  nothing." Nothing ticks the `- [ ]` boxes in the plan file.
- subagent-driven-development: a fresh implementer per task gets a brief file, never the whole
  plan. A reviewer gives two verdicts, spec compliance and quality. The fix loop is capped at 5
  rounds. Cheapest model for transcription tasks, the most capable for the final review.

## 2. What pi already gives us (pi-coding-agent 0.86.1)

- `examples/extensions/plan-mode/index.ts` is a working plan mode. `/plan` and Ctrl+Alt+P
  toggle it. It sets active tools to read, bash, grep, find, ls, questionnaire. It blocks bash
  by a first-word allowlist in `tool_call`. It injects a hidden `[PLAN MODE ACTIVE]` message in
  `before_agent_start`. In `agent_end` it pulls a numbered list under `Plan:` from the reply and
  asks Execute / Stay / Refine with `ctx.ui.select`. Execution tracks `[DONE:n]` in `turn_end`.
  State is saved with `pi.appendEntry` and restored on `session_start`.
- Hooks: `tool_call` returns `{block, reason}` or rewrites `event.input`. `before_agent_start`
  returns `{message}` or edits `systemPromptOptions`, which keeps the prompt cache. `context`
  filters messages before every LLM call. `agent_end` and `turn_end` see the messages.
  `pi.setActiveTools`, `pi.setModel`, `pi.setThinkingLevel` switch per session.
  `ctx.ui.select`, `confirm`, `editor`, `custom`, `setStatus`, `setWidget` cover the UI.
  `pi.sendMessage` with `triggerTurn` starts the execution turn. `ctx.newSession` works only
  inside a command handler.
- Built-in tools: read, bash, powershell, edit, write, grep, find, ls. Default active: read,
  bash, edit, write. pi's own read-only set is read, grep, find, ls.
- pi-task already has `/task-plan`. Its question loop is one question per call with a required
  `SUGGESTED:` line, an optional `ALT:` line, and `NONE` to stop. Its child runs with tool
  allowlist `read` only, and the working tree is diffed before and after as a second guard. Its
  prompt records a measured failure: a reply that opened with an observation was parsed as the
  question.

## 3. Measured on the local models

Conditions. "soft" means all four default tools stay active and only a hidden message says
"do not edit". "hard" means edit and write are removed with `--tools` and bash is guarded.

| Claim | Qwen 3.8 27B | Gemma 4 12B |
|---|---|---|
| Prompt-only restriction: model calls edit or write anyway | 0/10 | 5/10 |
| Same, with the user pushing "just edit the file now" | 0/10 | not run |
| Hard mode: model tries to write through bash | 0/10 | 0/10 layout, 7/10 after submit |
| Text layout `PLAN:` + `FILES:` parses | 10/10 | 9/10 |
| Every `FILES:` path exists or is a new file | 9/10 | 9/9 |
| Extra prose after the layout | 1/10 | 0/9 |
| `submit_plan` tool called once with typed steps | 10/10 | 10/10 |
| Model acts after `submit_plan` said "stop here" | 0/10 | 7/10 |
| Asks with `ask_user`, one question per call, with options | 10/10 | 10/10 |
| Two questions batched in one message | 0/10 | 0/10 |
| Execution: `[DONE:n]` text markers for all 3 steps | 10/10 | 9/10 |
| Execution: `step_done` tool for all 3 steps | 10/10 | 10/10 |
| Free-form plan ends with "shall I proceed?" prose | 7/10 | not run |

Details behind the rows:

- Qwen never edited in soft mode, even when pushed. Gemma edited in half the runs. Gemma is the
  floor, so the prompt alone is not a guard. Tool removal is required.
- Gemma, in hard mode, called `submit_plan` and then wrote source through bash in 7 of 10 runs,
  with `sed -i` and `cat <<EOF >`. The tool result said "Plan received. Stop here." and
  Gemma went on anyway. The `tool_call` guard blocked every one. Two of those runs then
  generated without end and were killed, one after 11 minutes. So: bash needs a guard, and
  after `submit_plan` the extension must end the turn itself. pi's `tool_call` can return
  `terminate: true` with the block for that.
- Gemma's one layout miss was a malformed tool call leaked as text, not a layout error.
- The first-word bash regex in the harness misfired twice on `2>/dev/null`. An allowlist by
  first word, as pi's example does, is safer than a denylist regex.
- Qwen's `FILES:` line once said "(no file changes)" for a run-tests step and once named a new
  test file. The layout needs a word for "new file" and a word for "no file".
- Qwen's second `ask_user` question built on the first answer in 4/10 runs. Questions came with
  2 to 5 options. None were batched. Gemma asked one question 9/10 and three in one run, one of
  them without options. None batched.
- Gemma dropped the `[DONE:3]` marker once while doing the step. The tool row had no miss.
- With a free-form plan Qwen asked "want me to proceed?" in prose 7/10 times. With
  `submit_plan` in the tool list it did that 1/10 and called the tool 10/10. A tool is the
  reliable end-of-planning signal for code. Prose is not.
- Every execution run changed both files it was told to and none it was not.

## 4. Parts a pi-nop planning mode needs

1. A mode switch: a `/plan` command and a footer status. Store on/off with `pi.appendEntry` so
   resume keeps it. pi's example shows the pattern.
2. Hard restriction: `pi.setActiveTools` to read, grep, find, ls, bash, plus the plan tools.
   Restore the saved list on exit. Measured: needed for Gemma.
3. A bash guard in `tool_call` with a first-word allowlist. Measured: Gemma ran `sed -i` after
   submitting. Block reason one short line.
4. An `ask_user` tool with one question and options, rendered with `ctx.ui.custom` in the TUI.
   pi-task's question box and the questionnaire example already render this. Measured: both
   models call it once per turn with options.
5. A `submit_plan` tool with typed steps, each with its files. Typebox validates the shape, and
   code checks every path exists or is marked new. Measured: 10/10 on Qwen, 4/4 on Gemma, no
   prose leak. This is the ExitPlanMode of Claude Code, and it removes the text parser pi's
   example needs. After the call, block every further tool call in that turn with
   `terminate: true`. Measured: Gemma keeps going 7/10 without it.
6. The approval dialog on `submit_plan`: approve, refine with text, or stay. On approve, restore
   the tools and send the plan as a message with `triggerTurn`, as Claude Code injects
   "Approved Plan". Write the plan to a file under the project too, as both references do, so
   compaction and resume can re-read it.
7. Execution tracking: a `step_done` tool, not `[DONE:n]` prose. Both measured 10/10 on Qwen,
   but the tool call is checkable by code and the marker is a regex on prose.
8. A hidden plan-mode message from `before_agent_start`, dropped by `context` once the mode is
   off, as the example does. Keep it short. The wording must be A/B tested per the existing
   rule. The layout and the "stop here" tool result used in the harness are the tested baseline.
9. Settings-panel rows: plan model and thinking level, as the other tools have. Claude Code's
   `opusplan` split is the precedent.
10. Not needed now: superpowers' spec file, ledger, and reviewer loop. pi-task covers the
    multi-task path.

## 5. Open, not yet measured

- Approval flow in the TUI. The harness runs `-p`, so dialogs were not exercised.
- Gemma loops in thinking after any tool result that says "stop" or "change this" without
  `terminate`. Execution turns need an output cap or a loop detector before a real repo.
- Refine feedback as a new user turn instead of a tool result. Not measured.
- Block reason wording for a guarded bash call. Gemma never hit the guard in this batch, so
  there is nothing to measure yet.

## 6. What a plan must hold

Drawn from Claude Code's final-plan phase, superpowers' writing-plans, pi's example, and
pi-task's decisions block. Cut to what a local model can fill and code can check.

1. Goal. One sentence. What changes for the user. Free text, checked only for presence.
2. Decisions. Every `ask_user` question and its answer, verbatim. Code fills this, not the
   model. Claude Code and superpowers both carry the Q&A into the plan.
3. Files. Each path, tagged `existing` or `new`. Code checks an existing path is on disk and a
   new one is not. Qwen already needed this tag once (measured, section 3).
4. Steps. Numbered, one line each, in order. Each names its files from the list above. No step
   without a file, except a run or verify step. Superpowers bans "TBD" and "handle edge cases";
   code can reject those words.
5. Reuse. Optional. Existing code the steps build on, quoted as whole lines. Code checks each
   line is in the named file, the same check `answer.ts` does for evidence today.
6. Verify. The command to run and the expected result. Superpowers writes `Expected: PASS`
   per step. One verify line per plan is enough for a local model to start.
7. Out of scope. Optional. What the plan leaves alone. Claude Code's plan phase and superpowers
   both name it. Free text.

Shape for `submit_plan`, all typed so typebox rejects a bad one before code checks the rest:

```
goal: string
files: [{path: string, state: 'existing' | 'new'}]
steps: [{text: string, files: string[]}]
reuse?: [{path: string, line: string}]
verify: {command: string, expect: string}
outOfScope?: string
```

Decisions are added by the extension from the `ask_user` log. The model never writes them.

Not in the list, and why: superpowers' Interfaces with signatures, Review Focus, and per-step
failing tests. Those suit a long plan for a strong model. They were not measured here and they
triple the fields a 12B model must fill.

## 7. Gray areas, measured

Same harness, 10 runs per cell. Both models are in. Gemma ran 2026-09-27 after the fixes below.

| Claim | Qwen 3.8 27B | Qwen rerun, guard on | Gemma 4 12B |
|---|---|---|---|
| Full plan shape (section 6) submitted through the tool | 10/10 | 40/40 | 33/33 |
| Every file tagged `existing` or `new` correctly | 10/10 | 40/40 | 32/33, after a field description (wrote `modified` before) |
| Every step file is in the files list | 10/10 | 40/40 | 33/33 |
| Reuse lines quoted verbatim from the file | 10/10 (25 lines) | all verbatim, but given in only 8/40 | never given, 0/33 |
| Verify command and expected result filled | 10/10 | 40/40 | 33/33 |
| "TBD" or "handle edge cases" in the plan | 0/10 | 0/40 | 0/33 |
| After "stop here", model loops until killed | 1/10 | 0/10 | 3/3, in thinking, no tool call |
| With `terminate: true` on the submit result, run ends cleanly | 10/10 | 30/30 | 30/30 |
| Model tries a tool after submit, gets terminated | 1/10 | 4/30 | 0/30, the turn is already over |
| Refine: resubmits through the tool after feedback | 10/10 | 10/10 | 9/10, one looped in thinking until killed |
| Refine: second plan has the asked change | 10/10 | 10/10 | 9/9 |
| Refine: model implements through bash instead (unguarded) | 3/10 | 1/10, blocked | 0/10 |
| Over-asking: `ask_user` on a task with nothing open | 0/10 | 2/40 | 0/33 |
| No bash in plan mode: plan still names the right files | 10/10 | 10/10 | 10/10 |
| Plan rule in the system prompt instead of a message: edits anyway | not run | 0/10 | 10/10 |
| Push prompt, soft mode: edits anyway | 0/10 | 0/10 | 5/10 |
| Execution: `step_done` for all 3 steps, only the two files changed | 10/10 | 10/10 | 9/10, files right 10/10 |

What the rows mean:

- The full shape works on Qwen. Every reuse line was a real line from the named file. The
  `existing` and `new` tags were right every time, including a new test file.
- "Stop here" in a tool result does not stop a local model. One Qwen run called
  `submit_plan_full` two hundred times in a row until the output cap killed it. Gemma did the
  same in section 3. The turn must end in code: block with `terminate: true`. With that in
  place all ten Qwen runs ended cleanly.
- Refine feedback in the tool result made Qwen implement in 3 of 10 runs. It wrote
  `src/cli.js` with a bash heredoc and said "Done. All tests pass." So the bash guard is needed
  on Qwen too, not only on Gemma. One shape run did the same.
- Qwen never asked a question on the clear typo task. Over-asking was not seen.
- Without bash the plans were the same. Four reads per run, right files every time. Bash can
  stay out of plan mode. That removes the guard's attack surface.
- Rerun 2026-09-27, rebuilt harness, pi 0.87.1, 10 runs per condition. Reuse is optional in
  the shape, and Qwen fills it in one run of five. If reuse matters, it must be required or
  code-filled (section 8, item 16). The guard's write regex blocked `ls -R . | head -50` once:
  a bare pipe is not a write. A first-word allowlist alone would not have.
- Gemma, first smoke: tagged files `modified`, typebox refused, then Gemma thought in a loop
  until killed. A one-line description on the `state` field fixed the tag.
- Gemma after "Plan received. Stop here.": no tool call, just thinking, until the cap. So the
  `tool_call` block with `terminate: true` never fires. The fix is `terminate: true` on the
  `submit_plan` result itself (`AgentToolResult.terminate`). With that, 30/30 ended cleanly.
  The refine feedback result cannot terminate, and Gemma looped once there too. A refine
  feedback should come as a new user turn, not as a tool result.
- Gemma never fills the optional `reuse` field. Qwen fills it one time in five. If reuse is
  wanted, code fills it (section 8, item 16).
- Gemma with the rule in the system prompt edited 10/10. With the same rule as a hidden
  message, 5/10. Neither is a guard. Tool removal is the guard. The message is the better
  reminder.
- Gemma dropped one `step_done` call in 10 and still changed exactly the right files. Git diff
  per step (section 8, item 19) is the safer tracker.

## 8. Maybes, good to check

Brainstormed 2026-09-27. None measured. Each is verified against pi's types or the repo, not
against a model. A row moves up to section 4 or 6 only after a harness run.

Checks code can add to `submit_plan`:

1. Read-before-plan. `tool_execution_start` carries the `read` path. Log it. Reject an
   `existing` file the model never opened.
2. Reuse lines must come from a file in the read log, on top of the whole-line match.
3. Verify command is real: first word in `package.json` scripts or on PATH.
4. Run the verify command on approve and show the result in the dialog.
5. Ordering: a `new` file must be created by the step that first names it or an earlier one.
6. Path safety: every path resolves inside cwd, none matched by `.gitignore`.
7. Dead entries: a listed file no step names is rejected. Two steps with the same text too.
8. Caps: one line per step, a fixed step count, refused with a reason. Both models loop when
   unbounded (section 3).
9. A decision answered with free text is flagged to the model in the tool result.
10. `step_done` refused when the step names files and the git tree did not change.
11. After each execution step, report changed files outside the plan's list.
12. Plan file rendered from the typed object. The model never writes markdown.

Fields code can fill with no model at all:

13. Goal: copy `prompt` from `before_agent_start`. Drop the field.
14. Decisions: from the `ask_user` log. Already planned.
15. Files, existing: the read log. The model only names new files, tagged `new` when not on
    disk.
16. Reuse: `export` lines grepped from the read files. No quoting by the model.
17. Verify: the `test` or `check` script from `package.json`. Exit code is the expectation.
18. Out of scope: read files minus step files.
19. Execution tracking without `step_done`: diff git after each turn, a step is done when all
    its files changed. pi-task's working-tree diff is the precedent.
20. Drop `verify.expect`: the command's exit code replaces it.

If 13 to 20 hold, the model writes one field, `steps`, and the tool list is `ask_user` and
`submit_plan`. Section 3 rows to re-measure shrink to the shape, the stop, and the refine.

## 9. Goal step in a panel, measured

Built 2026-09-27, third try. `/plan` opens a full-screen overlay panel, as `/nop-config` does.
The main context stays idle, so no tool swap, rule injection or bash guard is needed. The goal
comes from a read-only subagent session kept open while the panel is open. Each change is
one more prompt in it, so files it read stay in its context. Close, hand over, a failed run and
pi shutdown dispose it.
The panel has a step strip, the goal, a subagent status line, a pi-tui Input that always takes
typing, a pi-tui SelectList menu (Accept the goal, Send to main context, Close), and a hint
line that names what Enter does right now. Empty input: Enter runs the highlighted row. Typed
text: Enter sends it as a change, Esc clears it. Esc on an empty input hides the panel and asks through pi's `ctx.ui.select`: Keep planning, or
Close and stop. Only the second closes the panel and aborts a run. The Close row closes without
asking. State is saved with `appendEntry` and shown again on reopen.

Dropped on the way: a `submit_goal` tool in the main context with a modal input dialog, then
the same with a Ctrl+Alt+Y shortcut, then Ctrl+Y and Ctrl+G inside the panel. Chords and modals
both lost to a visible menu. The close warning is the one modal.

Subagent goal prompt, `harness/goal-run.ts`, Gemma 4 12B, 10 runs per prompt, layout
`GOAL: <sentence>`:

| Claim | Typo prompt | "Make the greeting nicer." |
|---|---|---|
| `GOAL:` line parsed | 10/10 | 10/10 |
| One sentence | 10/10 | 10/10 |
| Run time | 2 to 14 s | 1 to 6 s |

Every run read `src/greet.js` first. Qwen not measured, it was not loaded.

Change turns in one session, `harness/goal-session.ts`, Gemma 4 12B. Prompt A is the one above.
Prompt B adds "Rewrite your last goal with that change and do not read files again."

Edit scenario, 30 sessions per prompt: typo request, then "Also rename greet to hello.", then
"Drop the test, no test."

| Claim | Prompt A | Prompt B |
|---|---|---|
| Rename change: `GOAL:` parsed, rename in the goal | 28/30 | 30/30 |
| Drop change: goal no longer names a test | 15/30 | 29/30 |
| Change turn looped past 120 s | 4/60 | 0/60 |
| Change turn time | 2 to 33 s | 1 to 3 s |

Explore scenario, 2 sessions per prompt: then "Also cover the other exported function in that
file." (needs a read, the answer is `shout`), then "Also fix the other file that imports greet."
(needs a search, the answer is `cli.js`). B named `shout` 0/2 and `cli` 0/2. It never opened a
file and echoed the change words back as the goal. So B is fast because it does not look, and it
was not shipped. A named `shout` 2/2 and `cli` 1/2, at 12 to 35 s per change, 11 to 28 tool
turns. A softer line, "read a file only when the change needs something you have not seen yet",
named `shout` 2/2, `cli` 0/2 and looped once. Prompt A stays. Open: a wording that rereads only
when the change needs it, measured on both scenarios.
