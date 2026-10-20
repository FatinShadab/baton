# Baton task sequence refactor

## Project and task model

Each open VS Code workspace is a Baton project. Project folders live under `globalStorageUri/projects/<repo-slug>_<path-hash>/`. `project.md` holds the project name, repo path, standing constraints, and agent/model preference sections; `digest.json` caches the depth-limited project digest. Each task has one session and a folder under `tasks/<12-char-id>_<slug>/` containing `task.md`, `state.json` with transition history, `triage.json`, `planning_prompt.md` when planning is needed, `plans/`, `race_map.json`, `handoffs/`, and `log.jsonl`.

Plans live inside their task folder. `state.json` is the resume source of truth. `done` and `abandoned` are terminal. A follow-up task may carry `parent_task_id`; tasks share only project-level files and explicit parent references. The sidebar shows the task state and next action. It warns when open race maps name the same files.

Legacy `tasks.json` and `sessions.json` records are migrated on activation. Each legacy task gets a folder inside its workspace project; old plans are preserved as `plans/legacy-plan.md`. A session containing multiple tasks is split into one session per task. Projectless legacy records use the currently open workspace as the default project. Legacy open tasks enter `awaiting_plan` so their old, unstructured plan can be resubmitted with a BATON summary. Records without an available workspace remain untouched until one is opened.

## Sequence

1. Creating a task requires an open project. Intake writes `task.md` and `state.json`.
2. Context gathering uses a cached project tree and available agent/model list, then adds task-specific matching files with sizes and line counts and filtered git status. It does not call an LLM or include prior task memory.
3. Clear small tasks and clearly broad tasks use heuristic triage. Borderline tasks request validated JSON with one retry, then fall back to a deterministic planning decision.
4. A direct task gets a single-step race map. A planning task gets a template prompt and enters `awaiting_plan` until a plan is submitted.
5. Plan intake validates the terminal summary block, step IDs, dependencies, enum values, and `plan_ref` headings before saving the plan. Referenced forbidden paths are rejected; absent and unselected files are reported.
6. Race maps use only the validated summary. A deterministic preference table chooses agents and models. Handoffs point to the plan file and section. Resubmitting a plan keeps the filename and rewrites only changed handoffs.
7. Session input is checked for drift before context gathering or routing. Explicit drift is rejected with a one-click new-task draft. Borderline scope decisions use strict yes/no JSON. Closed tasks are read-only.

## Iterations and verification

- Initial assessment: existing routing, history, sessions, terminal runner, and handoff UI were reused. The working tree already contained user edits; this refactor did not reset them.
- Storage, parser, triage, race builder, scope lock, migration, and editor integration were added. The new task flow bypasses the old general routing LLM; the old route API remains for the standalone route demo.
- Focused tests cover valid summaries, each listed validation failure, scope drift, task isolation, resume after restart for two tasks, selective handoff regeneration, overlap warnings, and both full flow branches. `npm run check`, `npm test`, and `npm run build` are the verification commands.
- Final local verification: TypeScript check, four focused tests, esbuild bundle, JavaScript syntax checks, and `git diff --check` passed. The flow has not been exercised inside a live VS Code extension host.

## Phase 1: Cross-Session Output Leak Fix

- **Diagnosis:** The webview message handler previously allowed untagged messages through if `data.sessionId` was missing, and did not filter by `data.taskId`/`data.task_id`. In addition, background output chunks were appended to whichever DOM container happened to be mounted.
- **Backend Fix:**
  - Created `TaskOutputManager` and `SessionViewOutputRouter` in `src/task-output.ts`.
  - Tagged all streamed output, chunks, and log lines with `project_id`, `task_id`, `run_id`, and `sessionId`.
  - Added per-task output buffer storage in `JsonStore` (`appendTaskOutput`, `getTaskOutputBuffer`, `setTaskOutputBuffer`).
  - Added full tagged log persistence in `log.jsonl` under each task folder.
- **Frontend Fix:**
  - Added per-task output buffer map `taskOutputBuffers` in `media/panel.js`.
  - Strict message routing: any incoming event with `sessionId`, `taskId`, or `task_id` that does not match the active session/task is filtered out. Background task output chunks are buffered in memory without rendering to the active DOM.
  - View change cleanup: unsubscriptions and buffer restores on active session switch.
- **Regression Test:** Added concurrent session test in `tests/task-flow.test.ts` running Task A and Task B concurrently with mid-stream active view switches, verifying zero cross-session leakage, complete buffer restoration, and listener cleanup.

## Phase 2: Chat-Based UI Flow, Intelligent Plan Intake & MCP Step Tools

- **Intelligent Plan Intake & Caching (`src/plan-extractor.ts`):**
  - Removed strict user-facing YAML summary block requirement; users can paste plans in any markdown format.
  - Added intelligent extraction with one retry feeding validation errors back to the model. Fast path for existing BATON summary blocks preserves zero token cost.
  - Caches extracted plan summaries by SHA-256 plan content hash (`<hash>.summary.json`), eliminating token costs on identical re-submissions.
  - Preserves original plan untouched in `plans/plan_<slug>_<id>.md` alongside `plans/plan_<slug>_<id>.summary.json`.
  - Deterministic checks validate step IDs (unique, acyclic, existing dependencies) and assert all `plan_ref` pointers match actual Markdown headings in the plan file.
- **MCP Step Summary Server Tools (`src/mcp/data.ts`, `src/mcp/server.ts`):**
  - Added MCP tools: `baton_get_step_summary(task_id, step_id)`, `baton_list_summaries(task_id)`, `baton_get_plan_summary(task_id)`.
  - Step summaries are saved per-step in `.baton/projects/<proj>/tasks/<id>/step_summaries/<step_id>.json` and `.baton/projects/<proj>/tasks/<id>/steps/<step_id>.summary.md`.
  - Downstream handoff prompts reference upstream summaries via MCP tool `baton_get_step_summary(task_id, step_id)` instead of inlining full text.
  - Dependent steps dynamically unlock to `Ready` when all prerequisite dependencies have saved summaries.
- **Modular Chat UI (`media/panel.js`, `media/panel.css`, `media/panel.html`):**
  - Replaced monolithic `renderFlowTurn` card with 5 distinct chat message components:
    - **Message 1 (Routing Decision):** States solely whether planning is needed and recommended web service (`Claude`, `Gemini`, `ChatGPT`). Direct tasks skip straight to Message 4.
    - **Message 2 (Planning Prompt):** Copyable prompt block with Copy button, file attachment list, open-service buttons (recommended service highlighted, others available). Updates bottom composer placeholder to "Paste the plan here...". Also includes inline paste area.
    - **Message 3 (Plan Intake):** Acknowledges accepted plan with structured step count and dependency overview.
    - **Message 4 (Task Tree):** Interactive step tree ordered by dependencies, displaying title, suggested agent, preferred model, parallel group badges, status badges (`Done`, `Ready`, `Blocked`). Expandable starting prompt with Copy and "Run in Codex". Finish summary textarea with "Save step summary" action.
    - **Message 5 (Completion):** Triggers when all steps have saved summaries. Displays completion banner, provides "+ Create new task" button linking `parent_task_id`, and locks composer read-only with a "Task complete" banner.
## Verification Pass (Phase 3)

- **Review of `media/panel.js`:**
  - Audited full file for leftovers from the interrupted edit: duplicate/dead functions, old `renderFlowTurn` remnants, syntax or logic errors.
  - Fixed message filtering logic: exempted `taskOutput` and `activeSession` from early task ID mismatch filtering so background buffers accumulate correctly.
  - Added active task output rendering (`appendTaskOutputChunk` and `renderTaskOutputBuffer`).
  - Merged background buffered output with incoming session history without wiping out in-memory chunks.
  - Exposed inspection hooks on `window` (`__batonGetTaskOutputBuffer`, `__batonActiveTaskId`, `__batonActiveSessionId`).
- **UI-Level Cross-Session Regression Test (`tests/panel-leak.test.ts`):**
  - Created DOM simulation harness supporting `MockElement` and `MockDocument` that loads and evaluates `media/panel.js` directly.
  - Dispatched interleaved tagged `taskOutput` messages for tasks A and B while switching active sessions.
  - Verified B's DOM contains zero output from A, and switching back to A restores A's complete output buffer with full DOM fidelity.
- **Dedicated Acceptance & Behavior Tests (`tests/task-flow.test.ts`):**
  - Added `completion lock (backend rejects input after done)`: verifies backend rejects input on `done` and `abandoned` tasks.
  - Added `step readiness unlock after a summary is saved`: verifies DAG transitions from blocked to ready upon dependency summary saves.
  - Added `plan extraction retry-with-error`: verifies validation error is fed back to retry prompt upon initial failure.
  - Added `extraction failure message`: verifies clear error when all extraction attempts fail.
  - Added `no-planning single-step path`: verifies direct tasks produce a single-step race map without entering `awaiting_plan`.
  - Added `resume from awaiting_plan`: verifies tasks preserve `awaiting_plan` state and prompt across editor restart.
  - Added `external planning service URLs map correctly`: verifies URL mappings for Claude (`https://claude.ai/new`), Gemini (`https://gemini.google.com/app`), and ChatGPT (`https://chatgpt.com/`).
- **Verification Commands and Results:**
  - `npm test`: 15 passed, 0 failed, 0 skipped, 0 cancelled (15/15 tests passing).
  - `npm run check`: TypeScript type check passes with 0 errors.
  - `npm run build`: Bundles build successfully with 0 errors (`dist/extension.js` and `out/mcp.js`).


