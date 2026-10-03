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

Send back, 2026-10-02. A reply with no `GOAL:` line, or with only a thinking block, used to be
dropped and shown as an error. Now it goes back to the model. Gemma 4 12B on this repo, request
"any misisng test" and then the same text as a change, 30 sessions per arm, two turns each:

| Claim | No retry | Note in the same conversation | Rewind, hint plus task |
|---|---|---|---|
| Turns that ended with a parsed `GOAL:` | 43/57 | 60/60 | 59/60 |
| First replies rejected | 14 | 13 | 16 |
| Rejected replies that were thinking only | 3 | 3 | 3 |
| Notes or restarts sent | 0 | 14 | 19 |
| Sessions that spent the budget | - | 0 | 1 |
| Total time | 1019 s | 946 s | 1326 s |

With no retry a thinking-only first reply fails the session, so 3 second turns never ran.

No retry against the note: Fisher p < 0.0001. The note against the rewind: no difference in
goals, the note is cheaper, so it shipped. The note is `noGoalNote` in `src/plan/goal.ts`. It
shares the `restarts` budget with the guards.

pi-ai leaves a thinking-only assistant message out of the next request, so the server gets two
user messages in a row. Gemma recovered 3/3. Qwen 3.8 answered a hand-built request of that
shape with a `GOAL:` line, 1/1.

Shipped code, same two turns: Gemma, 15 sessions, 29/30 turns parsed, 7 replies sent back and
7/7 recovered. The one lost turn was two loop kills and a ground kill, no send back in it.
Qwen 3.8, 10 sessions: 20/20 turns parsed, nothing sent back, so the note itself is
unmeasured there.

Not measured: a guard kill in the attempt that answers a note. The restart then sends the guard
hint and the note.

Reviewed in four rounds by a second model. No round found a bug in the loop. Each test gap it
named is now a test that fails when the line is broken.

## 10. Questions step in the panel, measured

Built 2026-10-02 on pi 1.0.0. Accept starts one questions run in the same subagent session. An
`ask_user` tool (`src/plan/ask.ts`) shows one question in the panel and waits. Options are rows,
typed text is a free answer, and the tool result is `Answer: <text>`. Each answer is saved
before the tool returns. The tool is in the session from its first turn, and the system prompt
never changes, because either change empties the cache on a local model.

Code refuses a call in the Goal turn, a blank question, fewer than two distinct options, a quote
that is not one whole line of the named file, and a second question while one is on screen. The
quoted file is found through pi's own read tool, so a path resolves as the model's read did. It
may be outside cwd, and only a regular file is read. A question asked again gets its saved
answer. The run's last text is ignored. Finish and Change goal close the session. Since section
12 the end of the run and Finish both start the steps run. A failed run
or a reopened panel offers "Ask questions", which starts a fresh session with request, goal and
answers as text.

Guards and the waiting tool: the tool-call guard gives `ask_user` no timer. The ground guard
judges calls that end while a question is in flight only when the last question ends, so a dead
call cannot stop a question the user is reading. A refused question is not a "seen" call, since
the model is told to ask it again. A saved answer given again is flagged by the tool and counts
as dead. A question stopped by a guard leaves the screen, and text typed for it is dropped.

pi cuts an overlay from the bottom (`slice(0, maxHeight)`) and never tells the component its
height, so a tall question lost its rows and input. The panel now has no `maxHeight`, reads
`tui.terminal.rows`, and shrinks its body in steps until it fits: answers become a count, the
goal becomes one line, the full option text shows only for the highlighted row. If nothing
fits, room goes in this order: input, hints and a scrolling menu, the question text, the rest of
the menu, the quote, the heading, the picked option, the context. A long error is cut to fit.
Seen on the real screen at 46, 30 and 20 rows, in fullscreen and regular mode. pi's ScrollView
does not clip inside an overlay: its clipping is `renderLayoutFrame`, root only, not exported.

Harness: `harness/questions-*`, runs in `harness/runs/questions/`. All through the real pi
(`pi -p -e <probe> "/probe"`), so the numbers are for the runtime packages.

Cache, append-only:

| Check | Qwen 3.8 27B | Gemma 4 12B |
|---|---|---|
| Request k is a byte prefix of request k+1, tool list equal (recording proxy) | 290/290 | 671/671 |
| Server cache covers the previous prompt but its last 5 tokens | 290/290 | 671/671 |
| Same rule from pi's usage numbers, real repo, prompts up to 40k tokens | 130/130 | 156/156 |
| Abort while the tool waits, then prompt the same session again | 3/3 | 5/5 |
| Tool that ignores the abort signal: the run never settles | not run | 2/2 |

A re-rendered assistant tool call is the only thing the server recomputes. File reads never
are. A guard restart rewinds the run by design, so the prefix changes there.

Prompt wording, Gemma, 30 sessions per scenario, 4 scenarios (vague request, clear typo, an
answer that points at other code, a new command), repo guards on. Failed = loop guard hit or a
runaway past the probe cap.

| Variant | Failed | Goal parsed | Asked on the vague request |
|---|---|---|---|
| A: goal prompt as is, question rules in the accept message | 15/120 | 117/120 | 9/30 |
| B: one combined system prompt | 26/120 | 111/120 | 26/30 |
| C: B + "You are planning, not implementing. Do not change any file." | 20/120 | 111/120 | 28/30 |
| D: A + that same line in the accept message | 2/120 | 118/120 | 14/30 |

D shipped. D on Qwen: 0/40 failed, goal parsed 40/40. Without the planning line Gemma drifts
into implementing after an answer and loops on reads, or thinks "I need to actually perform the
change" until the output limit. Thinking off on Gemma is worse (B: asks 12/30, loops 39/90).

Behaviour with D:

| Check | Qwen | Gemma |
|---|---|---|
| Two `ask_user` calls in one assistant message | 0/50 | 0/130 |
| A file read happened before the first question | 24/24 | 39/39 |
| Quoted line verifies or is NONE, fixture | 15/15 | 37/37 |
| Quoted line verifies, real repo | 32/39 | 8/8 |
| After a rejected question the model asks again (forced; Gemma run was variant B) | 4/4 | 23/23 |
| `ask_user` during the Goal turn | 7/50 | 0/130 |
| Goal still parsed after that rejection | 7/7 | none seen |
| Same question asked twice, verbatim | 1/40 | 0/120 |
| Fresh session (request, goal, answers as text): answered question asked again | 0/10 | 0/30 |
| Restart shape (guard note, answers as text, same session): asked again | 0/10 | 0/29 |
| Questions run ends with empty text | 0/60 | 0/128 |
| Real repo, 10 sessions: goal parsed | 10/10 | 5/10 |
| Real repo: sessions that hit a guard or the output limit | 0/10 | 6/10 |
| Real repo, questions per session | 2 to 7 | 0 to 4 |

The 7 bad quotes on Qwen: 2 wrong paths, 3 quotes of several lines, 2 misquotes.

Shipped code (`harness/questions-product.ts`), Qwen, fixture, 10 sessions: goal 10/10, ended
10/10, cache rule 59/59. "Not asking yet" fired 3 times and "Give 2 to 5 options." once, and
every one of those sessions still finished. Real repo, 5 sessions: goal 5/5, 13 questions, every
quote verified, cache rule 61/61, no restart.

Gemma 12B limit, not caused by this step: on the real repo the Goal turn alone, with no
`ask_user` tool, ran to the output limit in 6 of 6 finished sessions, about 350 s each. No guard
catches a thinking or repeated-text runaway. Section 11 adds one.

The Gemma restart run had 30 sessions. One ran away in its Goal turn and never reached the
questions.

Reviewed in seven rounds by a second model, each claim checked and each real one pinned by a
test that fails when the fixed line is broken again. Left as is: with no tool call ids from the
server, two calls of one tool that end out of order can swap.

Open: the "one question per call" refusal was never triggered by a model. The hand-over wording
is pi-task's and was not re-measured on the main model. Qwen cells have 10 sessions, not 30.

## 11. Repeat guard, measured

2026-10-03. Gemma 4 12B, Goal turn only, this repo, no `ask_user` tool, 23 turns over two
requests ("Add a Questions step to the /plan panel.", "Add a Steps step to the /plan panel.").
Thinking text was logged this time.

| Outcome | Turns |
|---|---|
| `GOAL:` line | 14/23 |
| Ran to the output limit, 325 to 508 s | 7/23 |
| Killed by the loop guard | 2/23 |

So the runaway is 7/23 here, not the 6/6 of section 10. Six of the seven are one thinking block
that ends on the same lines over and over, 190k to 290k characters, block size 2 to 105 lines.
The seventh sent 80k output tokens with 80 characters of thinking and a 183 character `GOAL:`
line. What those tokens were is not known. The recording proxy did not catch one.

Detector: the non-blank, trimmed lines of one block end on the same run of lines N times in a
row. Replayed over the 262 healthy messages that had thinking text, over the six repeating
runaways, and over 10,943 source, JSON and Markdown files of this repo and its `node_modules`,
those under 300 kB, each one as if a model quoted it whole. "Two different" means the run holds at least two
different lines.

| Copies | Shortest run, lines | Healthy messages hit | Files hit | Runaways stopped | Slowest stop, characters |
|---|---|---|---|---|---|
| 2 | 2 | 3/262 | not run | 6/6 | 16.3k |
| 3 | 1 | 3/262 | 807 | 6/6 | 18.4k |
| 3 | 2 | 0/262 | 30 | 6/6 | 18.4k |
| 4 | 2 | 0/262 | 6 | 6/6 | 20.4k |
| 6 | 2 | 0/262 | 1 | 6/6 | 24.6k |
| 8 | 1 | 0/262 | 6 | 6/6 | 28.7k |
| 8 | 2 | 0/262 | 0 | 6/6 | 28.7k |
| 8 | 2, two different | 0/262 | 0 | 6/6 | 28.7k |

Three copies was the first pick. A review showed it trips on six closing braces in a row, since
indent is trimmed, and on `test/subagent/subagent.test.ts` quoted whole. A second review showed
that any one line sixteen times over still trips at eight copies: an empty grid, a zeroed buffer.
So the last row shipped as the `repeat` guard, `src/subagent/guards/repeat.ts`. More copies cost
little, since the runaway does not stop on its own. The shipped code replayed in 7 character
deltas stops the six after 6.1k to 28.7k characters. It hits none of the 266 messages that did
not run away: the 262 above and 4 that had no thinking text.

A second scan, `.ts`, `.js`, `.mjs`, `.cjs`, `.json` and `.md` files only, of any size: the shipped
code hits 1 of 10,798 files, a JSON tree nested eight deep, whose
closing lines go `}`, `]` eight times. A stack trace of two functions that call each other and a
retry log with no timestamps trip the same way. Each costs one restart.

A third review timed one line repeated 8,000 times: 16.7 s of CPU, since every run size was
walked before it was thrown out. Run sizes inside the tail of equal lines are now skipped. A
fourth review broke that tail with another line every 1,000 lines, 30,000 lines: 92.7 s. One
look at the line before the tail now rules a size out. A test runs both shapes and fails on the
test runner's time limit if either comes back.

Left as is, none was seen: a loop of one line, a loop where a number changes each round, a loop
with no line break. Thinking that arrives after the text of the same message has started joins
the text's lines, which needs a server that interleaves them.

Live, shipped `subagentSession` with the goal prompt and send back, Gemma 4 12B, this repo, the
same two requests, 30 sessions, `restarts` 2. The run used the guard before the one-line change.

| Outcome | Sessions |
|---|---|
| `GOAL:` line | 23/30 |
| Killed by the loop guard, budget spent | 4/30 |
| Killed by the repeat guard, budget spent | 2/30 |
| Ran to the output limit | 1/30 |

Without the guard 7/23 ran to the limit, now 1/30: Fisher p = 0.015. The repeat guard fired in 12
sessions, 16 times. What came next: a goal 9, repeat again 4, the loop guard 3. Sessions took 49
to 642 s, 87 minutes in all. The one at the limit had no restart, so it is not the repeating kind.

The hint ends with "Do not go over a point twice: decide with what you know and answer." An arm
without that sentence was stopped after 5 sessions, 4 goals, by the owner: about 16 restarts per
arm cannot show a difference. So the sentence is not measured.

Not measured: Qwen, the runaway with no visible output, and the hint sentence above.

## 12. Steps step in the panel, measured

Built 2026-10-03 on pi 1.0.0. When the questions run ends, or the user picks Finish, a steps run
starts in the same subagent session, or in a fresh one after Finish. The reply is a text layout,
checked in code and sent back with a note when it fails, as the Goal turn does. No new tool: the
tool list and the system prompt stay as they are. The rules go as a user message with every steps
turn and every change (`stepsRules` in `src/plan/steps.ts`):

```
The questions are done.
You are planning, not implementing. Do not change any file.
Now plan the steps that reach the goal, in order. Read the code you need.
Answer with this layout and nothing else:
STEPS:
1. <one line per step>
FILES:
- <path> (existing|new)
```

Code refuses a reply with no `STEPS:` or `FILES:` line, each alone on its line, with no step, with
a line between the two that is not `N.` or `N)` plus text, or with a line after `FILES:` that is
not `- <path> (existing|new)`, or with a `*` in a path. Text before `STEPS:` is ignored. A file tagged
`existing` must be a regular file that pi's read tool finds, a file tagged `new` must not be. The
file is found, not opened. Each refusal goes back
as a note that ends on the layout, from the `restarts` budget. The last reply is checked again in
the panel, since nothing is sent back once the budget is spent. A reply that still fails is a
failed run: the session closes, the panel shows an error, saved steps stay.

Typed text with steps on screen is a change: `Change asked by the user: <text>`, a blank line,
the rules. A session that does not hold the plan (reopened panel, failed run, Finish) first gets
request, goal and answers as text, and for a change the saved steps under `Current steps:`.
Hand over sends goal, decisions and the filled layout, as a follow-up when the main agent is
busy. Before this pi refused that message and the plan was lost.

The panel shows STEPS and FILES under the answers. On a short screen each step becomes one line,
then the files a count, then the steps a count. "Plan steps" is offered when the questions are
done and no steps are saved.

Harness: `harness/steps/`, runs in `harness/runs/steps/`. `steps-probe.ts` holds its own copy of
the strings and the parser, `steps-product.ts` runs the shipped code. Shipped goal and questions
code in every arm, a scripted user who picks the first option, fixture repo, requests "Make the
greeting nicer." and "Add a farewell command to the CLI.". The change is "Also update the
README.". Valid means parsed and every file tag right, after send backs.

Gemma 4 12B, 30 sessions per cell:

| Arm | Steps valid | Change turn valid |
|---|---|---|
| Text layout, same session | 60/60 | 58/60, 2 ran to the output limit |
| `submit_steps` tool in the session from turn one, then `DONE` | 58/60 | 45/58, 12 answered `GOAL:` |
| Text layout, fresh session after the questions | 60/60 | 60/60 |
| Change sent without the rules | 30/30 | 27/30, layout note sent 24 times |
| Change in a fresh session, steps as text | 29/29 | 28/29 |
| Same, README on disk, change "Also add a README." | 30/30 | 30/30 |

The tool lost: change turn 45/58 against 58/60, Fisher p = 0.002. It was also called in the Goal
or Questions turn 12 times in 60 sessions. A tool that ends the turn with `terminate` was tried
once: `subagentSession` reads the tool-call turn as an empty answer, and its change turn ran to
the output limit. Not pursued.

The file check is needed. In the fresh arm Gemma tagged a README that is not on disk `existing`
in 28 of 30 change turns, and the note fixed 28 of 28. With the README on disk and the change
"Also add a README." it tagged it `new` in 27 of 30, and the note fixed 27 of 27. A directory was
tagged `existing` once in 360 turns and got the "not on disk" note, which fixed it.

Qwen 3.8 27B, 10 sessions per cell:

| Arm | Steps valid | Change turn valid |
|---|---|---|
| Text layout, same session | 20/20 | 20/20 |
| Text layout, fresh session after the questions | 10/10 | 10/10 |
| Change in a fresh session, steps as text | 10/10 | 10/10 |
| Same, README on disk, change "Also add a README." | 10/10 | 10/10, tagged `new` once, fixed |

Real repo, request "Add a Steps step to the /plan panel.":

| Check | Qwen, 5 sessions | Gemma, 10 sessions |
|---|---|---|
| Goal parsed | 5/5 | 7/10 |
| Reached the steps turn | 5/5 | 5/10, the rest killed in Goal or Questions |
| Steps valid | 5/5, no send back | 4/5, 1 killed by the loop guard |
| Change valid | 5/5 | 4/4 |
| Steps per plan | 5 to 9 | 1 to 6 |
| Files per plan | 5 to 8 | 1 to 3 |
| Steps turn | 63 to 239 s | 5 to 43 s |

`ask_user` in a steps or change turn: Gemma 0 in 40 logged sessions, Qwen 2 in 50. It gets the
Goal-turn refusal, "Not asking yet. Give the GOAL line.". Both replies then missed the layout and
the layout note fixed both. Two cases cannot measure another wording, so it stays.

Parser. The probe dropped `` ` `` and `*` from every line. The shipped parser drops them only to
match the two labels and the file rows, so a step keeps `export * from`. Replayed over every valid
logged reply: Gemma 388/388, Qwen 103/103, same steps and files as the probe's parser. Text
before `STEPS:` in 5 Qwen replies, none on Gemma. No path listed twice. A step written as
`**1.** text` would be sent back; none in 491 replies.

A change rewrites the whole plan. Every earlier step came back word for word in 32 of 58 Gemma
change turns in the same session, and in 1 of 28 when the steps came as text.

Hand over, `harness/steps/handover.ts`: the message as the first prompt of the main model, default
tools, fixture repo, 10 runs per arm. Goal "Add a farewell command to the CLI that prints
"Goodbye, <name>!"".

| Arm | Model | Plan files changed, no other | Tests pass | Command works |
|---|---|---|---|---|
| Goal + a decision "test in the existing file" | Qwen | 10/10 | 10/10 | 10/10 |
| The same + 3 steps, 3 files | Qwen | 10/10 | 10/10 | 10/10 |
| Goal alone | Qwen | 0/10 of the 4 below | 10/10 | 10/10 |
| Goal + 4 steps, 4 files, one a new README | Qwen | 10/10 | 10/10 | 10/10 |
| Goal + a decision "test in the existing file" | Gemma | 10/10 | 10/10 | 10/10 |
| The same + 3 steps, 3 files | Gemma | 10/10 | 9/10 | 9/10 |
| Goal alone | Gemma | 0/10 of the 4 below | 10/10 | 10/10 |
| Goal + 4 steps, 4 files, one a new README | Gemma | 10/10 | 6/10 | 6/10 |

With the goal alone the test file was touched 7/10 on Qwen and 3/10 on Gemma, the README never.
The main model follows the file list. Gemma breaks the code more often when the plan gives it more
to write.

Shipped code, `steps-product.ts`, same scenarios:

| Arm | Model | Sessions | Steps valid | Change turn valid |
|---|---|---|---|---|
| Same session, farewell | Gemma | 15 | 15/15 | 15/15 |
| Change in a fresh session, nicer | Gemma | 15 | 15/15 | 15/15 |
| Same session, farewell | Qwen | 10 | 10/10 | 10/10 |
| Change in a fresh session, nicer | Qwen | 10 | 10/10 | 10/10 |

After that run two reviews tightened the parser: a label with text after it on the same line, a
file row with no path, and a path with a `*` are now refused, and the check no longer reads the
file. The shipped parser replayed over all 623 valid logged replies, shipped runs included: the
same steps and files on every one.

The shipped code again after those fixes:

| Arm | Model | Sessions | Steps valid | Change turn valid |
|---|---|---|---|---|
| Same session, farewell | Gemma | 15 | 15/15 | 15/15 |
| Change in a fresh session, nicer | Gemma | 15 | 15/15 | 15/15 |
| Same, README on disk, change "Also add a README." | Gemma | 15 | 15/15 | 15/15 |
| Same session, farewell | Qwen | 5 | 5/5 | 5/5 |

In the README arm every one of the 15 change turns had a reply sent back, and every plan ended
with the README tagged `existing`. A first run of that arm, 15 on Gemma and 5 on Qwen, is void:
the probe did not write the README. Those logs are in `harness/runs/steps/void/`.

Real TUI in tmux, fixture repo. On Gemma: request, accept, steps on screen, a typed change, hand
over, and the main model started on the steps. At 46 and 30 rows the whole plan shows, at 20 rows
the goal is one line and steps and files are counts. On Qwen, each seen once:

- Hand over while the main agent ran `sleep 240`: pi showed the message as a queued follow-up.
  When the command ended the main agent wrote `test/farewell.test.js`, the plan's `new` file.
- Close and reopen: the saved steps showed, and a typed change in the fresh session added a
  step and a file.
- Esc during the steps run, close, reopen: "Plan steps" led the menu and made the steps.
- Finish on a waiting question: the steps run started at once and ended with valid steps.

Reviewed twice by a second model before the code was written and twice after. Each real claim is
a test that fails when the line is broken: 37 mutants, 37 killed.

Left as is: pi-tui's `stripTerminalSequences` leaves some cursor sequences in model text, as it
does for questions. A layout inside a code fence, or with `### STEPS:` as its label, is sent back.
The `new` tag only says that no regular file is at that path. So a directory, a `{a,b}` glob,
or a path with a note after it all pass as `new`, and `path:12` tagged `existing` gets the "not
on disk" note and is accepted once tagged `new`. The layout given back with `<path> (new)` filled in passes. None
of these shapes is in the 631 logged replies. The last reply is checked against the disk a second time, so a file the main
agent creates in between fails the run. One note names one file, so two wrong files cost two of the budget, and with
`restarts` 0 a wrong tag fails the turn. After
Finish the old run holds its slot until it settles. A hand over during compaction or with no model
is still lost. An Enter pressed as a run ends lands on "Send to main context".

Not measured: a path outside cwd, which is not refused. A cap on step count or line length. The
panel on a plan longer than the screen shows counts, seen at 20 rows in tmux.
