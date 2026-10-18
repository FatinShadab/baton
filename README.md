# Baton

Baton is a VS Code sidebar for routing coding tasks. Type or speak a task, review
the context that will be shared, and get a structured route: task type, risk tier,
destination, and reason. The router tries Gemma 4 through Google AI Studio, then
Gemma through Ollama Cloud, then local rules. A deterministic policy gate may raise
risk, but never lower it. Tasks, plans, and outcomes are saved in VS Code's local
extension storage.

## Five-step live demo

1. Open [`demo-repo`](demo-repo) as the VS Code workspace and run `npm test` in
   its terminal. The single date parser test fails.
2. Open the Baton sidebar, click **Demo task** (or enter “Fix the failing test in
   the date parser”), then click **Prepare context**. Review the selected sources
   under **What will be shared**; deselect anything you do not want to send.
3. Click **Route task**. Show the answering router tier, moderate risk, and the
   **CONFIRM** policy action. Results may vary by provider; the rules fallback
   classifies this task as moderate.
4. Choose **Plan in ChatGPT** or **Plan in Gemini**. Baton copies a context-rich
   prompt and opens the web chat. Paste it there, then paste the resulting plan
   into Baton's **Implementation Plan** field and save it.
5. Click **Run in Codex**, confirm the workspace, and watch the VS Code terminal.
   Run the test again, inspect **Show diff**, then **Mark done** to save the
   outcome. The fix should make the UTC date assertion pass.

## Setup

Requires Node 18+, VS Code 1.85+, and the Codex CLI for execution.

```sh
npm install
npm run check
npm run build
npm install -g @openai/codex
codex
```

Launch the extension in a VS Code Extension Development Host. In the Command
Palette, run **Baton: Set API Keys** to save `GEMINI_API_KEY` and
`OLLAMA_API_KEY` in VS Code SecretStorage. Leave a prompt empty to keep its
existing key. Keys are optional; with no working provider, routing uses rules.
Voice transcription also asks for an `ELEVENLABS_API_KEY` through this command.

For the standalone router evaluation, run `npm run eval` from this repository.
It writes [`eval-results.md`](eval-results.md) and prints the same table. To
include live Gemma results, supply `GEMINI_API_KEY` as a temporary process
environment variable; the evaluation does not save it. Without a key, Gemma
cells are marked N/A rather than counted as errors. The ten hand-labeled tasks
and their expected risk tiers are in [`scripts/eval.ts`](scripts/eval.ts).

## Architecture

- **Sidebar:** Vanilla HTML, CSS, and JavaScript in `media/`; no webview
  framework. `src/extension.ts` connects UI messages to the services.
- **Context and memory:** `src/context.ts` assembles a preview from the README,
  filtered Git status and diff stats, the active editor, and matching local
  memories. Users select sources before routing. `src/store.ts` persists JSON
  under `context.globalStorageUri`; `src/memory.ts` indexes saved plans and
  outcomes for recall.
- **Routing:** `src/router/` validates Gemma or Ollama JSON with Zod, enforces
  an eight-second provider deadline, and falls back to `rules.ts`. The route is
  cached by task and selected context. `src/policy.ts` applies the independent
  risk gate after routing.
- **Handoff and execution:** `src/handoff.ts` copies a planning prompt to the
  clipboard and opens a web chat. `src/codex.ts` launches `codex exec` in a VS
  Code terminal with policy-required confirmation. `src/history.ts` records
  plans, approvals, status, and outcomes. `src/voice.ts` handles speech input.
- **Build:** esbuild bundles the TypeScript extension into `dist/extension.js`.

## Honest limits

ChatGPT and Gemini web planning use a manual handoff. Baton cannot read their
responses; paste the plan back into the sidebar. Codex execution goes through
the installed Codex CLI in a VS Code terminal, not a web chat or background API.
The extension does not infer that a terminal run finished successfully; run
tests and mark the outcome yourself. Live model routing needs working API keys
and access to the configured model tags. The rule router is a fallback, and its
keyword decisions can misclassify tasks; see the raw-risk evaluation table.

Context excludes `.env`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`,
`node_modules`, and `.git`, and skips files over 100 KB. Previewing context is
local; routing sends only the sources you keep selected, capped at 6,000
characters. Run actions require a trusted workspace.
