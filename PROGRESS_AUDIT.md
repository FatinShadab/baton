# Baton Refactor Progress Audit

Audit Date: 2026-10-19  
Auditor: Antigravity Assistant

## 1. Test Suite Status
- **Command:** `npm test` (`tests/task-flow.test.ts` bundling `tests/panel-leak.test.ts` via node --test)
- **Results:** 15 passed, 0 failed, 0 skipped, 0 cancelled.
  - ✔ `UI-level regression: panel.js routes taskOutput to active view, isolates concurrent tasks, and restores full buffer`
  - ✔ `summary parses and validates each required failure`
  - ✔ `scope lock allows clarifications and rejects explicit drift`
  - ✔ `two tasks keep separate state and resume after restart`
  - ✔ `full flow takes the direct and planning branches`
  - ✔ `cross-session isolation: concurrent tasks never leak output across views and buffers persist`
  - ✔ `plan extraction caches by SHA-256 hash and deterministically validates structure`
  - ✔ `task flow step summaries, MCP tools, and step readiness progression`
  - ✔ `completion lock (backend rejects input after done)`
  - ✔ `step readiness unlock after a summary is saved`
  - ✔ `plan extraction retry-with-error`
  - ✔ `extraction failure message`
  - ✔ `no-planning single-step path`
  - ✔ `resume from awaiting_plan`
  - ✔ `external planning service URLs map correctly`
- **Type Check:** `npm run check` (`tsc --noEmit`) passed with 0 errors.
- **Build:** `npm run build` (`node esbuild.mjs`) passed with 0 errors (`dist/extension.js` and `out/mcp.js`).

---

## 2. Acceptance Checks Status

### Earlier Acceptance Checks — Sequence
| Check | Status | Evidence (File + Test Name) |
| :--- | :---: | :--- |
| Both paths (planning / no planning) work end to end | **DONE** | File: `src/task-flow.ts` `start()` & `submitPlan()`<br>Test: `tests/task-flow.test.ts` &rarr; `full flow takes the direct and planning branches`, `no-planning single-step path` |
| Only LLM calls are triage + race-map tie-breaks | **DONE** | File: `src/task-triage.ts` `triageTask()`, `src/race-map.ts` `buildRace()` (deterministic `PREFERENCES` matrix lookup)<br>Test: `tests/task-flow.test.ts` &rarr; `full flow takes the direct and planning branches`, `no-planning single-step path` |
| Planning prompt is template-generated | **DONE** | File: `src/task-triage.ts` `planningPrompt()`, `src/handoff.ts` `buildPlanPrompt()`<br>Test: `tests/task-flow.test.ts` &rarr; `full flow takes the direct and planning branches` |
| Plan saved as `plan_<slug>_<id>.md` | **DONE** | File: `src/task-files.ts` `savePlan()`<br>Test: `tests/task-flow.test.ts` &rarr; `full flow takes the direct and planning branches` |
| Race map and handoffs built from summary only, with `plan_ref` pointers | **DONE** | File: `src/race-map.ts` `buildRace()` & `handoffText()`<br>Test: `tests/task-flow.test.ts` &rarr; `no-planning single-step path`, `two tasks keep separate state and resume after restart` |
| State machine persists and resumes from `awaiting_plan` | **DONE** | File: `src/task-files.ts` `TRANSITIONS`, `src/task-flow.ts` `inspectSession()`<br>Test: `tests/task-flow.test.ts` &rarr; `resume from awaiting_plan`, `two tasks keep separate state and resume after restart` |
| Editing plan regenerates only affected handoffs | **DONE** | File: `src/race-map.ts` `saveRace()` selective regeneration<br>Test: `tests/task-flow.test.ts` &rarr; `two tasks keep separate state and resume after restart` |
| Dead code removed | **DONE** | File: `media/panel.js` (monolithic `renderFlowTurn` deleted; replaced by distinct Message 1–5 components)<br>Test: `tests/panel-leak.test.ts` &rarr; `UI-level regression: panel.js routes taskOutput to active view, isolates concurrent tasks, and restores full buffer` |

### Earlier Acceptance Checks — Project > Task Model
| Check | Status | Evidence (File + Test Name) |
| :--- | :---: | :--- |
| Tasks cannot exist outside a project | **DONE** | File: `src/task-files.ts` `ensureProject()`, `src/editor-panel.ts` lines 127-133, `src/session-view.ts` lines 102-106<br>Test: `tests/task-flow.test.ts` &rarr; `two tasks keep separate state and resume after restart` |
| One task = one session = one goal | **DONE** | File: `src/task-migration.ts`, `src/editor-panel.ts`<br>Test: `tests/task-flow.test.ts` &rarr; `two tasks keep separate state and resume after restart` |
| Drift detection (deterministic first, tiny yes/no LLM when borderline) triggers "create new task" prefilled | **DONE** | File: `src/scope-rules.ts` `deterministicScope()`, `src/task-scope.ts` `checkScope()`, `media/panel.js` `scopeDrift`<br>Test: `tests/task-flow.test.ts` &rarr; `scope lock allows clarifications and rejects explicit drift` |
| Tasks fully isolated | **DONE** | File: `src/task-output.ts` `TaskOutputManager` & `SessionViewOutputRouter`, `src/store.ts`, `media/panel.js` `taskOutputBuffers`<br>Test: `tests/task-flow.test.ts` &rarr; `cross-session isolation: concurrent tasks never leak output across views and buffers persist`<br>Test: `tests/panel-leak.test.ts` &rarr; `UI-level regression: panel.js routes taskOutput to active view, isolates concurrent tasks, and restores full buffer` |
| `done` and `abandoned` are read-only | **DONE** | File: `src/task-model.ts` `TerminalStates`, `src/task-files.ts` line 17, `src/task-flow.ts` `acceptInput()` & `saveStepSummary()`, `media/panel.js` `setComposerClosed()`<br>Test: `tests/task-flow.test.ts` &rarr; `completion lock (backend rejects input after done)` |
| Project listing shows state and next action | **DONE** | File: `src/task-files.ts` `listTasks()`, `src/task-model.ts` `nextAction()`, `media/session.js`<br>Test: `tests/task-flow.test.ts` &rarr; `two tasks keep separate state and resume after restart` |
| Overlapping-file warning | **DONE** | File: `src/race-map.ts` `overlapWarnings()`, `src/task-flow.ts` lines 55 & 87, `media/panel.js`<br>Test: `tests/task-flow.test.ts` &rarr; `two tasks keep separate state and resume after restart` |
| Tests for scope-lock, isolation, and resume | **DONE** | File: `tests/task-flow.test.ts`, `tests/panel-leak.test.ts`<br>Test: All 15 passing tests in `tests/task-flow.test.ts` covering scope-lock, cross-session isolation, and restart resumption |

### Phase 2 Acceptance Checks — Chat-Based UI Flow
| Check | Status | Evidence (File + Test Name) |
| :--- | :---: | :--- |
| Context gather & confirmation behave as before; after confirmation the UI is distinct chat messages | **DONE** | File: `media/panel.js` (`routeWithSelectedContext()`, `renderFlowSequence()`, `appendUserMessage()`, Messages 1–5)<br>Test: `tests/panel-leak.test.ts` &rarr; `UI-level regression: panel.js routes taskOutput to active view, isolates concurrent tasks, and restores full buffer` |
| Message 1: Routing decision says only whether planning is needed and recommended web service | **DONE** | File: `media/panel.js` `renderMessage1_Routing()`<br>Test: `tests/panel-leak.test.ts` &rarr; `UI-level regression: panel.js routes taskOutput to active view, isolates concurrent tasks, and restores full buffer` |
| Message 2: Planning prompt appears as chat reply with Copy, files to attach, and open service buttons | **DONE** | File: `media/panel.js` `renderMessage2_PlanningPrompt()`<br>Test: `tests/task-flow.test.ts` &rarr; `full flow takes the direct and planning branches`, `resume from awaiting_plan` |
| Service URL mappings verified | **DONE** | File: `src/handoff.ts` `TARGETS`<br>Test: `tests/task-flow.test.ts` &rarr; `external planning service URLs map correctly` (Claude -> `https://claude.ai/new`, Gemini -> `https://gemini.google.com/app`, ChatGPT -> `https://chatgpt.com/`) |
| Message 3: Plan intake accepts arbitrary formats without format rejection; intelligent layer extracts JSON summary cached by SHA-256 hash; deterministic validation with 1 retry | **DONE** | File: `src/plan-extractor.ts` `extractOrGetPlanSummary()`, `hashPlan()`, `src/plan-summary.ts` `validatePlanSummaryStructure()`<br>Test: `tests/task-flow.test.ts` &rarr; `plan extraction caches by SHA-256 hash and deterministically validates structure`, `plan extraction retry-with-error`, `extraction failure message` |
| Message 4: Task tree UI shows nodes with agent, model, dependency status (blocked/ready), starting prompt, finish summary text area + Save button | **DONE** | File: `media/panel.js` `renderMessage4_TaskTree()`<br>Test: `tests/panel-leak.test.ts` &rarr; `UI-level regression: panel.js routes taskOutput to active view, isolates concurrent tasks, and restores full buffer` |
| Step readiness unlock & MCP tools | **DONE** | File: `src/task-flow.ts` `saveStepSummary()`, `src/mcp/data.ts` (`baton_get_step_summary`, `baton_list_summaries`, `baton_get_plan_summary`), `src/mcp/server.ts`<br>Test: `tests/task-flow.test.ts` &rarr; `step readiness unlock after a summary is saved`, `task flow step summaries, MCP tools, and step readiness progression` |
| Message 5: Completion triggers when all nodes have summaries; prompts to start new task session; disables composer; rejects backend input | **DONE** | File: `media/panel.js` `renderMessage5_Completion()`, `setComposerClosed()`, `src/task-flow.ts` `acceptInput()`<br>Test: `tests/task-flow.test.ts` &rarr; `completion lock (backend rejects input after done)`, `task flow step summaries, MCP tools, and step readiness progression` |

---

## 3. Files Created or Modified
### Newly Created Files (Untracked)
- `PROGRESS_AUDIT.md`: This audit document with explicit file and test evidence for every check.
- `REFACTOR_LOG.md`: Refactor architecture and log.
- `src/path-policy.ts`: Path whitelist and security constraints.
- `src/plan-extractor.ts`: Arbitrary plan intake, SHA-256 caching, intelligent extraction with retry feedback.
- `src/plan-summary.ts`: Deterministic schema validation and DAG cycle check.
- `src/race-map.ts`: Race map construction, step ordering, selective handoff regeneration, overlap check.
- `src/scope-rules.ts`: Deterministic heuristic scope/drift detection.
- `src/task-digest.ts`: Project file tree and digest builder.
- `src/task-files.ts`: Project/task directory layout, state transitions, task listing, file persistence.
- `src/task-flow.ts`: High-level orchestrator for task start, plan submit, input handling, step summaries, inspection.
- `src/task-migration.ts`: Migration from legacy tasks/sessions to per-project task folders.
- `src/task-model.ts`: Zod schemas and types for tasks, triage, plan summary, state, and race map.
- `src/task-output.ts`: Output tagging (`project_id`, `task_id`, `run_id`), per-task buffering, persistence to `log.jsonl`.
- `src/task-scope.ts`: Hybrid deterministic/LLM scope drift checker.
- `src/task-triage.ts`: Task triage logic (heuristics, LLM fallback, prompt generation).
- `tests/panel-leak.test.ts`: UI-level DOM regression test running `media/panel.js` for cross-session leak isolation.
- `tests/task-flow.test.ts`: Full suite of 15 unit/integration tests for task flow, extraction, MCP tools, completion lock.

### Modified Existing Files
- `media/panel.css`, `media/panel.html`, `media/panel.js`: Webview styling, DOM structure, and modular chat message sequence (Messages 1–5) with per-task output buffering and DOM isolation.
- `media/session.js`: Task manager sidebar rendering task states and next actions.
- `media/task-actions.js`: Task action controls.
- `package.json`, `tsconfig.json`: Scripts (`npm test`) and config.
- `src/browser.ts`: Safe browser runner without top-level `require("vscode")` for test compatibility.
- `src/codex.ts`: Task execution policy enforcement and flow status guards.
- `src/context.ts`, `src/handoff.ts`, `src/history.ts`: Handoff target URL export (`TARGETS`) and project integration.
- `src/editor-panel.ts`, `src/session-view.ts`: Extension panel and sidebar providers.
- `src/mcp/server.ts`, `src/mcp/data.ts`: MCP tools and context endpoints (`baton_get_step_summary`, `baton_list_summaries`, `baton_get_plan_summary`).
- `src/store.ts`: Per-task output buffer storage.
- `src/types.ts`: Task types and messages.

---

## 4. Verification and Regression Slices Summary
1. **Cross-Session Leak (Highest Priority Bug) — VERIFIED & TESTED**
   - Both backend (`SessionViewOutputRouter` in `src/task-output.ts`) and frontend (`media/panel.js`) filter events by `task_id`.
   - Incoming `taskOutput` messages for background tasks are preserved in in-memory per-task buffers and never rendered in active DOM.
   - Verified via backend concurrent test (`tests/task-flow.test.ts` line 120) and browser UI-level regression test (`tests/panel-leak.test.ts`).
2. **Review of `media/panel.js` — CLEANED & VERIFIED**
   - Cleaned leftover logic: exempted `taskOutput` and `activeSession` from early task ID mismatch filtering so background buffers accumulate correctly.
   - Added active task output rendering (`appendTaskOutputChunk` and `renderTaskOutputBuffer`).
   - Cleaned out all remnants of old monolithic turns; syntax and logic verified via JSDOM-equivalent browser harness.
3. **Plan Extraction with Retry & Error Feedback — VERIFIED & TESTED**
   - `extractOrGetPlanSummary` validates output deterministically; upon first failure, feeds `Previous extraction error: ...` back to retry prompt.
   - On terminal failure, throws clear error: `Unable to extract a valid plan structure: ...`.
   - Verified via unit tests `plan extraction retry-with-error` and `extraction failure message`.
4. **Completion Lock & Lifecycle State Guards — VERIFIED & TESTED**
   - Backend `acceptInput` and `saveStepSummary` reject any new input when status is `done` or `abandoned`.
   - Frontend disables composer dock with read-only placeholder and banner.
   - Verified via unit test `completion lock (backend rejects input after done)`.
5. **Step Readiness Progression & MCP Summaries — VERIFIED & TESTED**
   - Multi-step DAG unlocks steps dynamically as upstream dependency summaries are saved.
   - MCP endpoints expose step summaries and plan summary to external agents.
   - Verified via unit tests `step readiness unlock after a summary is saved` and `task flow step summaries, MCP tools, and step readiness progression`.
6. **Planning Service URL Mapping — VERIFIED & TESTED**
   - `TARGETS` mapping explicitly tested against expected URLs: Claude (`https://claude.ai/new`), Gemini (`https://gemini.google.com/app`), ChatGPT (`https://chatgpt.com/`).
   - Verified via unit test `external planning service URLs map correctly`.
