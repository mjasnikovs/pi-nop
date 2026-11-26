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
   per step. One verify line per plan is enough for a local model to start. Built in section 14
   as a list of commands with no expected result.
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
3. Verify command is real: first word in `package.json` scripts or on PATH. Not taken, section 14.
4. Run the verify command on approve and show the result in the dialog. Not taken, section 14.
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
17. Verify: the `test` or `check` script from `package.json`. Exit code is the expectation. Not
    taken: the model writes it, section 14.
18. Out of scope: read files minus step files.
19. Execution tracking without `step_done`: diff git after each turn, a step is done when all
    its files changed. pi-task's working-tree diff is the precedent.
20. Drop `verify.expect`: the command's exit code replaces it. Taken, section 14.

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

"Edit plan" opens the saved steps in pi's editor (`ctx.ui.editor`; Ctrl+G opens the external
one), with the panel hidden. The text is the hand over layout, `VERIFY:` kept with no command.
The same parser and file check as for a reply run on it, before the hand over. A refused edit
reopens with the user's text and a short reason in the title. An edit that parses to the saved
steps is not saved and the disk is not read. A saved edit closes the session, so a later change
goes to a fresh one with the edited steps under `Current steps:`. No model sees new wording, only
the user's steps in the measured layout, so this is not measured on a model. For a plan with no
command that fresh session is the weak path in section 14, "A repo with no tests": Gemma added a
command in 21 of 28 change turns.

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

## 13. Execution tracking, measured

Built 2026-10-03 on pi 1.0.0. Hand over of a plan with steps keeps the plan, saved with
`handed: true`. From then on the footer shows `plan: files 3/4 · outside 1`, and `/plan` opens the
plan with marks. No tool, no marker, no git, and the hand-over text is unchanged.

The tracker (`src/plan/track.ts`) reads the session branch after the handed entry. It takes the
`path` of every `edit` and `write` call of the main agent, failed calls too, and resolves each as
the plan's file check does, through pi's read tool. A FILES row is written or not. A written path
that is no FILES row is outside. A step is done when every FILES path its text names was written,
open when one was not, and not tracked when it names none. A path counts as named only whole, not
inside a longer path. The count runs at hand over, when an `edit` or `write` call ends, on
`session_start` and on `session_tree`. Nothing but the plan is saved. "Stop tracking" in the panel,
or a new plan, ends it.

Harness: `harness/track/`, runs in `harness/runs/track/`. The main model gets the hand-over message
as its first prompt, default tools, a fresh git copy of the fixture. Plan P4: 4 steps, 4 files, one
a new README. Plan PR: 5 steps, 3 files, two steps on `src/cli.js`, the last step "Run npm test".
Arm N is the shipped message. Arm T adds a `step_done` tool and "Call step_done after each step.".
Arm D adds "After completing a step, include a [DONE:n] tag in your response.".

Gemma 4 12B, 30 sessions per cell:

| Check | N, PR | T, PR | D, PR | N, P4 | T, P4 | D, P4 |
|---|---|---|---|---|---|---|
| `edit` and `write` call paths equal `git status` | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 |
| Plan files changed, no other | 30/30 | 29/30 | 28/30 | 30/30 | 30/30 | 30/30 |
| Tests pass | 30/30 | 29/30 | 27/30 | 24/30 | 21/30 | 22/30 |
| File rule: final marks right, steps that name a file | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 | 30/30 |
| File rule: a step shown done before it was, mid-run | 4/30 | 3/30 | 1/30 | 0/30 | 0/30 | 0/30 |
| Model marked every step | | 24/30 | 18/30 | | 30/30 | 22/30 |
| Model marked no step | | 3/30 | 5/30 | | 0/30 | 3/30 |
| Median prompt tokens per session | 43.9k | 73.9k | 40.2k | 38.9k | 46.5k | 29.5k |

Qwen 3.8 27B, 10 sessions per cell: call paths equal git 60/60, plan files exact 60/60, tests
60/60, `step_done` for every step 20/20, `[DONE:n]` for every step 20/20, no early mark. With
`step_done` the PR plan took 27.4k prompt tokens and 22.5 s against 12.2k and 13 s.

So the calls are the tracker. They matched git in 240 of 240 sessions and cost nothing. The model's
own marks were complete in 54 of 60 Gemma sessions with the tool and 40 of 60 with text. Three
Gemma sessions were killed at the run limit, one hung with the server idle and two ran away in one
turn. The main model has no guards.

Counting failed calls: 32 `edit` calls failed in the 240 sessions, each retried on the same file,
so the set with failed calls also equals git 240/240. pi's compaction file list counts calls the
same way. An `edit` or `write` aborted after it reached the disk returns an error with the file
changed (`edit.js`, `write.js`).

Bash: 597 calls, one write, Gemma `cat <<EOF > src/greet.js`. That file was also edited.

A tool in the main context, `harness/track/cache-run.ts`, Qwen, 2 sessions per arm, pi's usage
numbers: with the tool list fixed every request read the whole earlier prompt from the cache.
With `step_done` added at hand over the next request read 0 cached tokens, 2/2. Taking it out after
the plan cost the cache a second time, 2/2. With the tool in the list from the start nothing
reset, and the prompt grew by about 60 tokens.

Git, tried on a scratch repo: `git status --porcelain` gives paths from the repo root, not from
cwd. A second change to a file that was dirty before shows no difference. A file the agent commits
leaves the list. `git diff` against a `git stash create` snapshot sees the first two, but not an
untracked file. No git gives exit code 128. None of this is needed with the calls.

Steps and files in 823 logged plans (`harness/track/links.py` and a second count by a reviewer):

| | Gemma fixture | Gemma real repo | Qwen fixture | Qwen real repo |
|---|---|---|---|---|
| Steps that name a FILES path | 1638/1657 | 28/35 | 370/485 | 55/65 |
| FILES rows no step names | 4/1334 | 3/19 | 15/363 | 12/71 |
| Steps on a file another step names | 624/1657 | 22/35 | 51/485 | 12/65 |

The rest of the Qwen fixture steps are "Run npm test". On the real repo the unnamed steps say
`plan.ts` or name a function. Whole-path matching links the same 2091 of 2242 steps as a plain
substring, and drops one false link, `src/greet.js` inside `../src/greet.js`. So files are exact
and step marks are a reading of them. That is why the footer counts files.

Where it shows: a pi widget made of lines is cut at 10 (`MAX_WIDGET_LINES`), and real plans had 5
to 9 steps and 5 to 8 files. So the footer has the count and the panel has the list. On a short
screen files and outside become counts, then the steps.

pi facts used: when `tool_execution_end` fires the call is on the branch, 6/6 in a probe. A
`turn_end` handler makes pi rebuild the context at every turn of every session, so it is not used.
`getBranch()` keeps entries from before a compaction. A reload clears every status and then fires
`session_start`. pi exports no path resolver. A nested `createAgentSession` does not fire the main
session's events.

Shipped code in the real TUI through tmux, fixture repo, each seen once. Gemma: plan, hand over,
footer 0/3, 1/3, 3/3, `/plan` with four steps and three files marked, Esc closed it with no
question, a written NOTES.md gave `outside 1`, the same footer after `/reload`, a write aborted
while its arguments streamed was not counted and was not on disk, "Stop tracking" cleared the
footer and the panel was empty. Qwen: the same to 3/3, a `/tree` move to the hand-over message gave
0/3 with the files still changed on disk, and a fork from there kept 0/3.

A review by a second model found one bug: the count repaints the panel, and a
repaint put the highlight back on the first row, so Enter after a count picked "Stop tracking" or
the first answer. The panel now keeps the highlight when the rows and the question are the same.

A second review found the `turn_end` cost above and that every call was resolved again when a path
repeated. Both fixed. A third found that a plan with no FILES rows hid its outside files in the
panel. Fixed. A fourth showed that calls made inside a codemode script cannot be counted when they
happen: pi saves them on the script's result after every event a count could run on, and drops the
path of a call over 8 KB. So they are not read. A fifth found no fault in the code and four untested
lines, now tested. After the change to `tool_execution_end` the flow ran once more on Qwen in the
real TUI: footer 0/2, 2/2, and 2/2 after `/reload`.

Tests: `test/plan/track.test.ts` and new cases in the plan and panel tests. 63 mutants, 60 killed
(`harness/track/mutate.py`). The first count, 63 killed, came from a script that judged by the exit
code. See section 14.

Left as is:

- A write through bash, inside a codemode script, through another extension's tool, or by a `!`
  command is not seen.
- A step that shares a file with another shows done at the first write.
- A step that only runs or checks a file gets its mark from that file. Seen in the Qwen product
  run: "Run the test suite and a manual `node src/cli.js farewell Alice`" showed done.
- A step that names no file only ever shows a dot, and a FILES row no step names marks no step.
- A failed `edit` on a file never written would show it written. 0 in 240.
- Edits a busy main agent makes before the queued hand over arrives count.
- After a `/tree` move the footer follows the branch, not the disk.
- A step that writes `./src/a.js` for the FILES row `src/a.js` gets no mark.
- A symlinked path does not match its target. A `new` row that is a directory stays open.
- Tracking has no end of its own, so later edits in the session count as outside.

Not measured: the main model on a real repo, a plan longer than the screen in the handed panel,
the footer beside other statuses on a narrow screen.

## 14. VERIFY part, measured

Built 2026-10-04 on pi 1.0.2. The steps reply ends with a third part, the commands the main agent
runs when the steps are done. The layout (`stepsLayout` in `src/plan/steps.ts`):

```
STEPS:
1. <one line per step>
FILES:
- <path> (existing|new)
VERIFY:
- <the project's test command, nothing else on the line>
```

The `VERIFY:` label must be there, alone on its row, after the file rows. Every row after it is one
command, with or without a dash. A pair of backticks around the whole command is dropped. A bare
dash, an empty pair of backticks, or `none` in any case, in brackets or not, is no command, so the
list may be empty. A code fence or a second label after `VERIFY:` makes the reply no plan, and so
does a row with no dash beside rows that have one. A row that is only a closing tag is dropped. The
command is not checked and code never runs it. The panel shows the commands after the files, whole
at every stage of a short screen. Hand over sends the part after the files when the list is not
empty. Tracking does not read it.

Harness: `harness/verify/`, runs in `harness/runs/verify/`.

### Why: the main model

`main-run.ts`. The hand-over message as the first prompt of the main model, fixture repo, the
4-step plan P4 of section 13 with a new README. Gemma 4 12B, 30 sessions per arm:

| Handed plan | Ran the tests | Tests pass at the end |
|---|---|---|
| The shipped message, no verify part | 11/30 | 27/30 |
| A fifth step "Run npm test and confirm it passes." | 30/30 | 30/30 |
| `VERIFY:` and `- npm test` after FILES | 30/30 | 29/30 |
| The same and `- node src/cli.js farewell bob` | 30/30, the second command 29/30 | 30/30 |
| `VERIFY:` and `npm test` with no dash | 30/30 | 28/30 |
| `VERIFY:` before `STEPS:` | 30/30 | 29/30 |

With the run step the first test run failed and a later one passed in 19 of 30 sessions. Eight
more sessions were logged with the test output: 7 failed first, 6 of them because the model's edit
had dropped the `shout` export of `src/greet.js`. The four sessions that ended
red with a verify part are one shape: the tests ran, failed, and the model stopped with an empty
reply. Section 13 had 24/30 passing for the shipped message, so 51 of 60 in all.

Qwen 3.8 27B, 10 sessions per arm: tests ran 10/10 and passed 10/10 with no verify part, with the
run step and with `VERIFY:`. Gemma ran `npm test` word for word. Qwen ran it alone in 3 of 10
sessions and in a chain like `npm test 2>&1 | tail -8` or `npm test && node src/cli.js farewell
alice` in the rest. A piped or chained call hides the exit code, so a pass mark read from the bash
call would be wrong there. No mark was built.

### The wording: the planner

`plan-probe.ts`. Shipped goal and questions code, a scripted user, the requests and the change of
section 12. Test command means `npm test`, `node --test` or a file run with node. Gemma, 60
sessions per row, 30 per request:

| Row under `VERIFY:` | Steps valid | Change turn valid | Plan names a test command |
|---|---|---|---|
| No VERIFY part, the layout of section 12 | 60/60 | 59/60 | |
| `- <command that checks the work>` | 60/60 | 59/60 | 7/60 |
| The same and a rule "End with the commands that check the work." | 60/60 | 59/60 | 13/60 |
| `- <the project's test command>` | 58/60 | 57/58 | 58/58 |
| `- <command that fails now and passes when the work is done>`, 9 sessions | 9/9 | 9/9 | 1/9 |
| `- <the project's test command, nothing else on the line>` | 60/60 | 59/60 | 59/60 |
| `- <the project's test command, nothing else on the line, or none>` | 60/60 | 59/60 | 27/60, `none` 33 |
| The shipped row and a rule "If the project has no test command, the VERIFY row is: - none" | 60/60 | 60/60 | 39/60, `none` 21 |

`cmd-eval.py` ran every command under bwrap in a copy of the fixture and in a copy with a reference
farewell. With "command that checks the work" 139 of 142 farewell commands exit 0 before any work,
like `node src/cli.js farewell Alice`. Two of 37 for "nicer" wait on stdin, `grep -q "Hello"` with
no file. With "the project's test command" 5 of 58 rows had a note after the command, like `npm
test (or whatever the project uses, I'll check package.json)`, and bash fails on it. With "nothing
else on the line" 59 of 60 run as written. The other is `node --test<|"|>`, a model token.

A word for "no tests" in the layout or in the rules made Gemma write `none` on a repo that has
tests, 33 and 21 of 60. So the shipped wording has none.

Qwen, the shipped wording, 40 sessions: steps valid 38/40, change 38/38, a test command in 38/38.
The probe asked for the dash and Qwen left it out: the first reply was valid in 18 of 40, against
19 of 20 for the layout of section 12. 15 of 17 logged first replies were a plan with `npm test` on
its own row. So a row needs no dash.

Change in a fresh session, the steps and the part sent as text: Gemma 30/30 steps, 29/30 change,
the command kept in 28 of 29. Qwen 10/10, 10/10, kept in 10 of 10. In the same session Gemma kept
the command in 55 of 59 change turns.

### A repo with no tests

The fixture without `test/` and without the `test` script, the shipped wording:

| | Gemma, 60 sessions | Qwen, 20 sessions |
|---|---|---|
| Steps valid, the probe's parser | 54/60 | 20/20 |
| `none`, `None` or `(None)` | 42 | 1 |
| A bare dash, sent back twice, a failed turn | 6 | 0 |
| `npm test` anyway | 8 | 0 |
| A run command, like `node src/cli.js farewell` | 1 | 17 |
| `none` and a note, `n/a`, or a sentence | 3 | 2 |

So a bare dash and `none` are read as no command. The rest is handed over as written.

### Real repo

This repo, request "Add a Steps step to the /plan panel.":

| | Gemma, shipped layout before | Gemma, with VERIFY | Qwen, before | Qwen, with VERIFY |
|---|---|---|---|---|
| Sessions | 20 | 30 | 5 | 5 |
| Reached the steps turn | 9 | 12 | 5 | 5 |
| Steps valid | 4/9 | 5/12 | 5/5 | 5/5 |
| Command | | `npm test test/plan/panel.test.ts` 2, `bun test`, `npm test`, `bun test -- Tessa-only test/plan/panel.test.ts` | | `bun test` 4, `npm test` 1 |

Gemma is weak on this repo with or without the part. The `test` script here is `bun test`.

### Shipped parser

`replay.ts` ran the shipped `parseSteps` over every logged reply. 1270 plans the probe parsed: the
same steps and files on 1270, the same commands on 1266. On the other 4 the probe had cut a
backtick out of the middle of a row and the shipped parser keeps the row whole. 48 replies the
probe sent back are plans to the shipped parser, a row with no dash or a bare dash. 37 are refused
by both, such as a `GOAL:` line, `VERIFY:` before `FILES:`, or a tag like `(new|existing)`. All 178 logged
replies with no VERIFY part are refused.

pi facts, 1.0.2: pi exports nothing that parses a shell command or finds a project's test command.
A bash call that exits non-zero has `isError: true` and the text `Command exited with code N`. The
exit code itself is on the `tool_result` event only, not in the session.

### Shipped code

`plan-product.ts`, the shipped `src/plan/steps.ts`, same scenarios. Gemma, 15 sessions per row:

| Arm | Steps valid | Change turn valid | Commands |
|---|---|---|---|
| Fixture, farewell | 15/15 | 15/15 | a test command 15/15 |
| Fixture, nicer | 15/15 | 15/15 | a test command 15/15 |
| No tests, same session | 15/15 | 15/15 | none 14, `None provided in the environment.` 1 |
| No tests, change in a fresh session | 15/15 | 15/15 | first plan: none 13, `npm test` 2 |

Four of the 30 no-tests plans ended on a bare dash or on the label alone, the shapes the probe's
parser had refused.

Qwen, 10 sessions per row, first with the parser as planned, then with the two rules below:

| Arm | Steps valid | Change turn valid | Turns with a tag as a command, before | After |
|---|---|---|---|---|
| Fixture, farewell | 10/10 | 10/10 | 0/20 | 0/20 |
| Fixture, nicer | 10/10 | 10/10 | 1/20 | 0/20 |
| No tests, same session | 10/10 | 10/10 | 6/20 | 0/20 |
| No tests, change in a fresh session | 10/10 | 10/10 | 2/20 | 0/20 |
| Fixture, change in a fresh session | 10/10 | 10/10 | 0/20 | 0/20 |

Qwen ends some replies on a closing tag: `</parameter>`, `</function>`, `</tool_call>`,
`</thinking>`, or a cut `</`. A row needs no dash, so the first shipped parser read the tag as a
command, in 9 of 100 turns. One more turn had a `GOAL:` line after a dashed command. Two rules
came from that. A row that is only a closing tag is dropped. A row with no dash beside rows with a
dash makes the reply no plan, so text after dashed commands is sent back as before. Replayed over
the logs: the 9 turns give the right commands, the `GOAL:` turn and a Gemma reply with `<|"|>` on
its own row are refused, and 1575 other plans read the same. On the rerun 14 of 100 turns had a
reply sent back, 11 of them a `GOAL:` line in place of the steps, and every turn ended valid.

A change in a fresh session after a plan with no command: the current steps go as text with no
VERIFY part, above rules that ask for one. Gemma then wrote a command in 21 of 28 change turns,
`npm test` in 18, on the repo with no tests. In the same session it did so in 0 of 15. With a
`VERIFY:` and `- none` row added to the current steps it was 13 of 24, Fisher p = 0.15. Not shown
to help, so not built.

Real TUI in tmux, pi 1.0.2, fixture repo, request "Add a farewell command to the CLI.", each seen
once. Qwen: goal, one question, three steps, three files, `VERIFY` and `- npm test` on screen. At
46 rows the whole plan shows, at 30 each step is one line, at 20 steps and files are counts, at 14
only the part, the input and the menu are left. The part showed whole at all four. After hand over
the main model ran `npm test && node src/cli.js farewell && ...`, the footer went to 3/3, and
`/plan` showed the handed plan with the part under the files. Gemma: the same plan shape with four
steps, the main model ran `npm test`, the footer went to 3/3.

A second repo, `~/hub/mx5`: a design document, an `AGENTS.md` that says "Always run tests with
`AGENT=1`", a `test` script `AGENT=1 bun test`, and no source yet. Real TUI, each seen once:

| Model | Request | Command in the plan | The main model ran | Tests after |
|---|---|---|---|---|
| Qwen | A zod listing schema with a test | `AGENT=1 bun test` | `AGENT=1 bun test && bun run lint 2>&1 \| tail -5` | 13 pass |
| Qwen | A Hono health route with a test, then a typed change for a price formatter | `bun run test`, the same after the change | `bun run test` | 16 pass |
| Gemma | A phone schema with tests | `AGENT=1 bun test` | `AGENT=1 bun test test/schema.test.ts` | 22 pass |

The footer ended on 2/3 and 4/5 in the Qwen runs: `package.json` was changed by `bun add`, a bash
write the tracker does not see.

Tests: `test/plan/steps.test.ts`, `panel.test.ts`, `plan.test.ts`. 68 mutants of the new lines, 68
killed (`harness/verify/mutate.py`). The first run of that script counted every mutant as killed:
a filtered `bun test` run exits 1 here, the coverage threshold, so the fail count is the judge
now. With it 5 of the first 53 had lived: three got a test, two change no result and left the list.
After the two rules 5 more lived, the label and fence tests leaned on the new rule, and got tests.
A second reviewer's mutants found two more, a fence inside a row and a tag with a hyphen, now
tested.

The tracking mutants of section 13 run with the same judge: 60 of 63 killed, not 63. Of the three
that lived, `Outside: 0` got a test. The other two change nothing a user can see: the blank row
before empty counts sits in a stage that is never the first to fit, and the row count in `sameRows`
only matters for an empty menu. Two older gaps on the OUTSIDE rows, the wrap and the escape codes,
got a test too.

Left as is:

- The command is not checked. A note after it, a model token on its row, or `npm test` on a repo
  with no `test` script all go to the main agent as written. So does prose after the rows when no
  row has a dash.
- On a repo with no tests Qwen writes a run command that passes before any work, 17 of 20.
- A `~~~` fence, a label behind a dash (`- VERIFY:`), a dash behind a dash (`- -`), a tag behind
  a dash, two tags on one row, a bullet that is not a dash (`* npm test`, `1. npm test`) and
  `**None**` are read as commands. Of these only `- - none` is in the logged replies, 4 times, all
  in the arm whose rules named `- none`.
- A change turn rewrites the commands with the rest of the plan. Gemma changed them unasked in 4
  of 59 turns in the same session.
- A wrong command is fixed by a typed change, a whole model turn.
- A screen too short for the counts is cut from the top, so the commands go last but can go.
- A plan saved before this part has no commands and hands over as it did.
- No mark after hand over says the command ran.

Not measured: a repo with a test runner that is not npm or bun, more than three commands in the
panel, a repo with a test that needs a service that is not running.


## 15. A night on a real repo, measured

2026-10-05, pi 1.0.2. `~/hub/mx5`: a 375-line design document, three source files, three test
files, `AGENTS.md`. Real TUI in tmux first, then probes on the same checkout, read-only. Harness:
`harness/night/` (README there), runs in `harness/runs/night/`.

### Real TUI

Qwen 3.8 27B, one pi session, three plans one after the other, each handed over:

| Request | Questions | Steps | Files in the plan | Footer at the end | Tests after |
|---|---|---|---|---|---|
| Add a location field to the listing schema, with a test. | 1 | 5 | 2 | 2/2 | 24 pass |
| Add the listings API from DESIGN/PROJECT.md. No database yet, keep listings in memory. | 0 | 5 | 3 | 3/3 · outside 1 | 46 pass |
| Members should be able to sign up with an invite link. | 1 | 6 | 7 | 7/7 | 66 pass |

Each seen once and right: a typed goal change, a typed steps change, a new `/plan <text>` while a
plan is tracked, Esc on a question then "Close and stop" then `/plan` and "Ask questions", the
panel open while the main agent works, quit and `pi -c`, `/compact` then `pi -c`, a 100 by 24
terminal. `package.json` was the outside file, an `edit` call. `bun run lint` rewrote a file
through prettier, a bash write, not counted.

Gemma 4 12B: the first plan ended 2/2 with 23 tests passing. On the second the main model wrote
96,564 tokens inside one `edit` call, the server stopped at the context limit, and pi showed
"Working" until Esc, 20 minutes later. That is the main agent, which no pi-nop guard watches.

Faults seen in the TUI, each once:

- A typed steps change "Drop pagination" took pagination out of the steps. The goal still said
  "sort and pagination", on screen and in the hand over. The main model followed the steps.
- Qwen offered the option "Something else — let me describe it". Picked, it is the answer. The
  model asked nothing more and the row went to the main agent as a settled decision.
- At 24 rows the handed plan shows counts only: no row says which step or file is open.
- A step that names no plan file keeps its dot: 3 of 5 steps in the first plan, 2 of 5 in the second.

### Folder rows

Gemma wrote a folder as a FILES row, tagged `new`: `src/server/routes/`, `src/client`, `test/`.
The disk check passes it, since no regular file is there. The tracker then waited for a write to
the folder itself, so the footer could not reach the total.

| Model, whole flow on mx5 | Plans | Plans with a folder row |
|---|---|---|
| Gemma, shipped | 26 | 8 |
| Gemma, new goal line and circle guard | 30 | 5 |
| Qwen, all arms | 54 | 1 |

In the 3,485 plans logged before tonight, all on the flat fixture, there was none.

Now a FILES row is written once a file at or under its path was written, and a file under a plan
row is not outside (`holds` in `src/plan/track.ts`). The parser and the disk check did not change.
8 mutants of the lines, 8 killed.

Left as is: a row `.` or `src/` takes every write under it, so outside stays 0. A step that names
the folder with a slash the row does not have keeps its dot. A folder tagged `existing` still
gets the note "is marked existing but is not on disk".

### Circle guard

The proxy (`night/proxy.ts`) caught what section 11 could not: Gemma thinking that loops while one
line changes each round, so no block of lines repeats.

```
Wait, I'll check if I should use `sql` for the listing edit logic.
Yes.
I'll proceed.
Actually, I'll start.
Wait, I'll check if I should use `sql` for the listing sold action logic.
Yes.
```

The model wants to write a file and has no tool for it ("Since I don't have a `mkdir` tool, I'll
just try to create the file."). The repeat guard stops such a block only once the changing line
runs out of new values and the round comes back whole: after 37.4k characters in one capture,
17.9k and 16.8k in two more.

Detector: one thinking block says two different sentence lines N times each, with any lines
between. A sentence line starts with a letter and ends with `.`, `!` or `?`. Without that rule
healthy thinking that drafts code trips it: a fence 37 times in one block, `}` 29 times in another.
`night/circle-table.py`, over 4,899 healthy thinking blocks (262 of section 11, 4,636 from every
saved pi session on this machine, Qwen and kimi main agents, and one of tonight's) and 12 loops
(the six of section 11, six captured tonight):

| N | Healthy blocks hit | Loops stopped | Stop at, characters |
|---|---|---|---|
| 3 | 3/4899 | 12/12 | 2.3k to 13.8k |
| 4 | 2/4899 | 12/12 | 2.4k to 15.9k |
| 6 | 0/4899 | 12/12 | 2.6k to 16.3k |
| 8 | 0/4899 | 12/12 | 3.6k to 16.7k |
| 12 | 0/4899 | 11/12 | 4.3k to 17.3k |
| 16 | 0/4899 | 9/12 | 4.8k to 18.0k |

The loops missed at 12 and 16 are captures another guard had cut short. The most a healthy block
said its second line was 5 times ("This is correct." 6, "Correct." 5). In the saved sessions the
most was 2. N = 8 shipped as the `circle` guard, `src/subagent/guards/circle.ts`, thinking blocks
only. The shipped code replayed in 7 character deltas (`night/circle-replay.ts`): 0 of 4,899
healthy blocks, 12 of 12 loops, stops at 3.6k to 16.7k characters. The repeat guard on the same 12:
6.1k to 37.4k. The line splitting moved to `guards/lines.ts`, shared with the repeat guard. The
old and the new repeat guard gave the same trips on 20,000 random event streams (a reviewer's
check).

Live, Gemma, whole flow on mx5, 30 sessions: circle fired 5 times, each in a questions turn, and
every session ended with a valid plan. The two captured trips were loops ("I'll
start." 8, "I'll do it." 8; "I'll check if there's anything else about the invite link." 8,
"No." 10). On Qwen it fired 0 times in 58 sessions.

32 mutants of the guard and the line reader, 32 killed (`night/mutate.py`).

Left as is: a walk over eight items that ends each on the same two verdict lines trips it, none
was seen. A run that ends at the output limit with no thinking loop was not captured: the hint
text is the repeat guard's with a new first sentence, and what follows a trip was seen 5 times.

### Goal turn on Gemma, not shipped

Shipped code, Gemma, whole flow, five mx5 requests, 30 sessions: 26 plans. All four lost sessions
died in the goal turn, killed by the loop guard. Past the goal turn steps were valid 26/26 and the
change 26/26. The captures show why: after reading the design document the model plans to write
the code ("I'll write the file."), has no tool for it, and rereads.

`night/goal-probe.ts`, the goal turn alone, three requests, arms in turn each round. One line
added to the goal prompt:

| Arm | Sessions | Goal | No guard restart | Tool turns per session | All sessions took |
|---|---|---|---|---|---|
| G0 shipped | 45 | 43 | 30 | 16.4 | 28 min |
| G1 "You do not do the task. Do not plan it and do not write code." after line 1 | 45 | 45 | 42 | 8.2 | 11 min |
| G2 "You are planning, not implementing. Do not change any file." after line 1 | 15 | 13 | 10 | 22.5 | 11 min |
| G3 "Someone else does the task after you. You only name the goal." after line 2 | 45 | 45 | 44 | 3.6 | 4 min |

No restart, G0 against G3: Fisher p = 0.0002. The planning line of the accept message does not
help here. G3 goals name less of the design document.

Whole flow with G3 and the circle guard, Gemma, 30 sessions: 30 plans, change valid 30/30, 28
minutes against 51. Questions asked 36 against 24. The guard restarts moved to the questions turn
and every one recovered.

Qwen, goal turn alone, 12 sessions per arm: G0 12/12, G3 12/12, 4.0 and 4.1 tool turns. Qwen,
whole flow, three requests, 9 sessions per arm, arm P shipped, arm Q with G3 and description B
below: P 9 plans, 1 guard restart, steps turn 38 s on average; Q 8 plans, 6 restarts, 128 s. The
restarts on both arms are the late `ask_user` below, so the arms cannot be told apart yet. G3 is
not in `src/`. Open: P against Q again once the late `ask_user` is fixed, one change per arm.

### `ask_user` after the questions, not fixed

Recorded on Qwen: in the steps turn the model wrote the steps and called `ask_user` in one
message. The tool answered "Not asking yet. Give the GOAL line.", the text meant for the goal turn.
The model then answered `GOAL: ...` and asked again. Each refusal is an error, so eight of them trip
the ground guard, and a `GOAL:` reply is sent back as a bad layout. This is the `GOAL:` line that
section 14 counted in 11 of 14 send backs.

Qwen, shipped code, whole flow, 13 sessions: 3 had a restart in the steps turn. With G3: 4 of 9,
one plan lost on a `GOAL:` reply.

`night/refuse-batch.sh`: goal then steps with no questions turn, so open points are left. Qwen:

| Arm | Sessions | Steps valid | Sessions with a late `ask_user` | Late calls | Restarts in the steps turn |
|---|---|---|---|---|---|
| R0 shipped refusal | 10 | 8 | 4 | 9 | 3 |
| R1 "The questions are done. Decide this yourself." | 5 | 5 | 2 | 5 | 2 |
| R2 "The questions are done. Decide this yourself and give the steps." | 5 | 5 | 1 | 1 | 0 |
| R3 `ask_user` taken out of the tool list for the steps turn | 14 | 13 | 0 | 0 | 1 |

R3 is the owner's idea. It empties the cache once: the first request of the steps turn read 6.2k
tokens fresh at the median, 9.6k at most, and 7,541 tokens took 4.4 s. Every later request was
cached again. The one R3 session lost and one of the two R0 sessions lost hit the probe's 600 s
limit while a second batch shared the server, from 07:11 to 07:42, so no time in this table can be
compared. Too few sessions to pick. Nothing is in `src/`: a version with R1 was built, tested and
taken out again.

Open: R0, R2 and R3 with one batch on the server, 30 sessions each. R3 in the goal turn too, where
Qwen called the tool in 7 of 50 sessions (section 10). The prefill on a session of 40k tokens.

### An option like "Other", not shipped

The scripted users of the older probes pick option 1, so they never met it. An option that is no
answer ("Other (please specify)", "Something else — let me describe it"):

| | Questions | With such an option |
|---|---|---|
| Qwen, logs before tonight | 276 | 36 |
| Gemma, logs before tonight | 650 | 54 |
| Gemma tonight, shipped description | 78 | 17 |
| Gemma tonight, B: shipped + "The user can also type an answer, so give no option like "Other"." | 13 | 0 |
| Qwen tonight, shipped description | 25 | 0 |
| Qwen tonight, B | 29 | 1 |

Picked, Gemma asks the same thing again with the same kind of option, four times in one session.
Qwen went on and guessed. B is not shown to help. Not built.

### Review

One blind round by a second model on the tracker and the guard. No fault in the code. Its limits
are in the lists above. One mutant of its own lived: a reset of the circle counts on a text start
too, which no input from this server reaches.

Not measured: the stale goal after a steps change on the main model (`night/contra-run.ts` is
written and was not run), the circle hint against any other wording, anything tonight on a second
repo.

## 16. A second night on a real repo, measured

2026-10-05 to 06, pi 1.0.3, Qwen 3.8 27B. `~/hub/mx5`, branch `night2` from "night base", one
commit per run. Real TUI in tmux, driven by a script that picks row 1. Harness: `harness/night2/`.

### Real TUI

| Run | Request | Questions | Steps | Plan files | Footer, shipped | Tests after |
|---|---|---|---|---|---|---|
| 1 | Add login, logout and me from DESIGN/PROJECT.md. No database yet, keep users and sessions in memory. | 0 | 7 | 7 | 5/7 | 29 pass |
| 2 | Add an image pipeline as in DESIGN/PROJECT.md section 7: a function that takes an upload and returns full and thumb webp. With tests. | 0 | 4 | 3 | 2/3 | 34 pass |
| 3 | Admin should be able to ban a member. | 1 | 4 | 4 | 4/4 | 39 pass |
| 4 | Limit login attempts with the hono-rate-limiter package instead of the hand-made limit. | 0 | 4 | 4 | 4/4, with the stamps below | 39 pass |
| 5 | Build the listings feature end to end from DESIGN/PROJECT.md: routes, photos, search, sort, pagination, owner checks, sold. In memory, no database. | 0 | 7 | 7 | 7/7 | 71 pass |
| 6 | Add the admin users list from DESIGN/PROJECT.md section 5, with the listing count per user. With tests. | 0 | 4 | 4 | 4/4, every change of tonight in | 74 pass |
| 7 | Add a contact reveal endpoint for listings, as in DESIGN/PROJECT.md section 5. | 0 | 3 | 1 | 1/1 | 76 pass |

Run 7: the endpoint was there, and the goal said so. A typed goal change ("Only add the missing
test") gave a goal for one 404 test. A typed steps change added a 401 test to the steps; the goal
on screen and in the hand over still named the 404 test alone. The main agent wrote both tests, as
in section 15: the steps win, 2 of 2 seen.

Run 5's plan was 24 rows and the panel showed each step on one line. Qwen asked a question in 1
of 6 runs.

"Fix the bug in the payment module.", a module the repo does not have: the goal turn wrote "Fix
the bug in the payment module so payments process correctly without errors." The first question
said that no such module is there and asked what was meant. Two of its four options were no answer
("I meant a different file/module — I'll name it").

### A plan file a command writes

Runs 1 and 2 ended with every step done and the footer short: `package.json` and `bun.lock` were
plan files and the main agent changed them with `bun add`, a bash call. In the 102 plans logged on
mx5 last night 47 list a `package.json`.

Now hand over saves a stamp per FILES row, the file's change time and size or nothing when it is
not on disk (`stamps` in `src/plan/track.ts`, `disk` in the plan entry). A row whose stamp differs
counts as written, and the count also runs when a bash call ends. Run 4 listed `package.json` and
`bun.lock`, the main agent ran `bun add`, and the footer ended 4/4. 18 mutants of the lines, 18
killed (`night2/mutate.py`). Three blind review rounds. Round 1: a new request typed while hand
over reads the disk sent the old plan, now dropped. Round 2: a reload in that wait left a pi that
throws, now caught, and no test pinned the time half of the stamp. Round 3: no fault in the code.

Left as is: a codemode script's end starts no count. A tree move back to the hand over still shows the files the other branch changed,
since the disk does not move back. A folder row sees a command only when it adds or removes an
entry right inside the folder. A file rewritten with the same content counts (`git stash` and
`pop`). An entry saved before the stamps counts calls only.

### `ask_user` after the questions, 30 sessions per arm

The open rows of section 15, one batch alone on the server. `night/refuse-batch.sh q2refuse 10
"R0 R2 R3"` with the shipped goal prompt: goal, then steps with no questions turn, then one change.
mx5 on "night base". Logs `runs/night/q2refuse-*`.

Qwen:

| Arm | Sessions | Steps valid | Change valid | Sessions with a late `ask_user` | Late calls | Sessions with a restart | Steps plus change, median |
|---|---|---|---|---|---|---|---|
| R0 shipped refusal | 40 | 40 | 40 | 9 | 16 | 9 | 62 s |
| R2 "The questions are done. Decide this yourself and give the steps." | 30 | 30 | 30 | 9 | 17 | 1 | 36 s |
| R3 `ask_user` out of the tool list | 30 | 30 | 30 | 0 | 0 | 0 | 43 s |

Restarts, R0 against R2: Fisher p = 0.04. R0 against R3: p = 0.008. Every late call of R0 was in the listings request, 9 of 20 sessions. With R2 it came in all three requests. After
a late call the steps turn went on with no restart in 1 of 9 sessions with R0 and 8 of 9 with R2.
R3 read 2.8k tokens fresh at the median on the first request of the steps turn, 8.7k at most. R0
and R2 read 103.

Ten of the R0 listings sessions came from a probe left over from a start on the wrong branch. It
ran beside the batch until 22:59, so the R0 time is not clean. The counts stand.

Gemma, same batch, logs `runs/night/g2refuse-*`:

| Arm | Sessions | Goal | Steps valid | Change valid | Sessions with a late `ask_user` |
|---|---|---|---|---|---|
| R0 | 30 | 24 | 24 | 24 | 0 |
| R2 | 30 | 24 | 23 | 23 | 0 |
| R3 | 30 | 27 | 26 | 26 | 0 |

Gemma never called `ask_user` after the questions, so no arm shows it anything. Its losses are the
goal turn of section 15 again: 15 of 90 sessions died there with the shipped goal prompt.

R2 went into `src/` first. The whole flow below, with the questions turn, showed the model
calling `ask_user` eight times in a row past the R2 refusal, 5 restarts in 30 sessions. So R3 is
what shipped: `subagentSession.prompt` takes the names of tools to leave out, the session's
active tools are set before each turn, and the steps turn runs without `ask_user`
(`src/subagent/subagent.ts`, `src/plan/plan.ts`). A goal turn call still gets "Not asking yet".
10 mutants, 10 killed.

### Goal line G3 on Qwen, whole flow

`night2/goal-ab.sh q2goal 5`: the five-request flow of section 15 with the R2 refusal, arm P the
shipped goal prompt, arm Q with the G3 line, three requests, 5 sessions per cell:

| Arm | Sessions | Goal | Steps valid | Change valid | Questions | Sessions with a late `ask_user` | Guard restarts in the steps turn |
|---|---|---|---|---|---|---|---|
| P shipped | 15 | 15 | 15 | 15 | 27 | 3 | 3 |
| Q G3 | 15 | 15 | 15 | 15 | 21 | 4 | 2 |

Qwen does not tell the arms apart, as in the goal turn alone (12/12 each). Gemma did, in section
15: 45/45 against 43/45 goals, 44 against 30 sessions with no guard restart, p = 0.0002, and the
whole flow 30/30. G3 is now the third line of the goal prompt in `src/plan/goal.ts`.

### Gemma in the real TUI, Try again

Gemma 4 12B, `night2` after the five Qwen runs, "Add a logout-everywhere action that ends all
sessions of the current user. With a test." The goal turn was killed by the loop guard twice, after
its restarts. The third run gave a goal in 30 s, one question, three steps, three files, footer
3/3, 71 tests passing.

With the G3 line, two more Gemma runs on `night2`: "Sellers should be able to delete one of
their photos. The remaining photos keep their order." gave a goal in 51 s with no kill, two
"verify" steps since run 5 had built it, and the main agent ran the tests and changed nothing,
footer 0/2. "Members can change their display name. With a test." gave a goal in 3 s, the
questions turn was killed by the loop guard once and "Ask questions" ran it again, then four
steps, 4/4, and the main agent broke one older test (77 tests, 1 fail). Gemma wrote `npm test` as
the VERIFY row of the first plan, on a bun repo.

After the kill the panel showed "Type what you want done." and the request was gone: the first
goal run saves nothing, so a failed one left the user to type it again. Now the panel keeps the
request and the error and offers a "Try again" row, which runs the same request once more; typed
text is a new request. The panel forgets the request when it closes or the session changes. 9
mutants, 9 killed. Two blind review rounds: the first found the row missing after a reply with no
GOAL line, and an older failed request shown after a later one; the second found no fault.

### Review and open

Blind review rounds by a second model: three on the stamps, two on Try again, one on the tool
removal. The last round of each found no fault in the code.

Open: the stale goal after a typed steps change (section 15) is not measured; `night/contra-run.ts`
is still unrun. A handed plan longer than the screen shows counts only. An option that is no answer
("I meant a different file/module — I'll name it") is still offered, 2 of 4 options in the payment
question. Gemma's goal turn with G3 on a real repo was measured last night only through the probe,
not in the TUI. mx5 is left on `night2` with six Qwen runs and one Gemma run committed; the server
runs Qwen.


## 17. Stale goal after a typed steps change, measured

2026-11-26, pi 1.6.0, Qwen 3.8 27B as the main model. `night/contra-run.ts`, the farewell fixture:
the goal asks for a farewell command and a README, the typed change was "No README." and the
steps leave the README out. The hand over goes to `pi -p` in a fresh copy of the fixture. 10
runs per arm, counted by whether `README.md` was written.

| Arm | Hand over | Wrote README |
|---|---|---|
| K0 | shipped: goal, steps | 10/10 |
| KC | control: goal and steps both want the README | 10/10 |
| K1 | K0 plus a blank line and `Change asked by the user: No README.` | 1/10 |
| K2 | K0 plus "Where the goal and the steps differ, follow the steps." | 9/10 |
| K5 | K1 plus a second change line, one newline between | 0/10 |
| K4 | KC steps, the README back as an edit would put it, with the K1 line | 0/10 |

K0 against K1: Fisher p = 0.0001. Sections 15 and 16 saw the steps win 2 of 2 in the real TUI.
Here the goal won 10 of 10. Tests passed and the farewell command worked in all 60 runs.

Shipped: K1. `PlanState.changes` keeps each typed steps change that gave steps, and hand over
sends them after the steps in the K1 and K5 layout. A new goal and "Change goal" start from the
idle plan, so they drop them. An edit keeps them, which K4 shows loses an edit that undoes a
change. Gemma was not run.
