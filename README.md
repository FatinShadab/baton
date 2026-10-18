# Baton

Baton is a VS Code sidebar for routing coding tasks. Type or speak a task, review
the context that will be shared, and get a structured route: task type, risk tier,
destination, and reason. The router tries Gemma 4 through Google AI Studio, then
Gemma through Ollama Cloud, then local rules. A deterministic policy gate may raise
risk, but never lower it. Tasks, plans, and outcomes are saved in VS Code's local
extension storage.

## Five-step live demo

1. Open this Baton repository in VS Code and press **F5**. The **Run Baton**
   launch profile builds the extension and opens an **Extension Development
   Host** in the current repository. The demo project is [`demo-repo`](demo-repo);
   run `npm test` there to see the single failing date parser test.
2. Open the Baton sidebar, click **Demo task**, then click **Prepare context**.
   This selects the demo project; ordinary typed tasks use the open workspace.
   Review the selected sources
   under **What will be shared**; deselect anything you do not want to send.
3. Click **Route task**. Show the answering router tier, moderate risk, and the
   **CONFIRM** policy action. Results may vary by provider; the rules fallback
   classifies this task as moderate.
4. Choose a planning handoff. Baton uses installed Codex, Claude Code, or
   Antigravity extensions when available, or opens ChatGPT or Gemini in a
   browser. Review the prompt, then paste the resulting plan into Baton's
   **Implementation Plan** field and save it.
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

For local debugging, open this repository folder in VS Code and press **F5**
(or choose **Run Baton** in Run and Debug). Its prelaunch task runs `npm run
build`; the new Extension Development Host opens the Baton repository. Click the Baton
activity-bar icon there to open the sidebar. After changing TypeScript or
webview files, run `npm run build` in the source window, then press **Ctrl+R**
in the Development Host to reload the updated extension. On macOS use **Cmd+R**.

In the Command Palette, run **Baton: Set API Keys** to save `GEMINI_API_KEY` and
`OLLAMA_API_KEY` in VS Code SecretStorage. Leave a prompt empty to keep its
existing key. Keys are optional; with no working provider, routing uses rules.
Voice transcription also asks for an `ELEVENLABS_API_KEY` through this command.
During F5 development, Baton also imports those three keys from the extension
repository's ignored `.env` into SecretStorage when the Development Host starts.
Reload the Development Host after changing `.env`. The file is never added to
task context or sent to a provider; only the requested API key is used for each
call.

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
- **Routing:** `src/router/` validates Gemma or Ollama JSON with Zod, bounds
  external calls, and falls back to `rules.ts` with a visible reason. Successful
  model routes are cached by task and selected context; temporary rules fallbacks
  are retried. `src/policy.ts` applies the independent
  risk gate after routing.
- **Handoff and execution:** `src/handoff.ts` builds a planning prompt. It opens
  the installed Codex extension for ChatGPT handoff, places the prompt in the
  installed Claude Code composer, or opens Antigravity with the prompt copied
  for pasting. ChatGPT and Gemini browser handoffs remain available. `src/codex.ts` launches `codex exec` in a VS
  Code terminal with policy-required confirmation. `src/history.ts` records
  plans, approvals, status, and outcomes. `src/voice.ts` handles speech input.
- **Build:** esbuild bundles the TypeScript extension into `dist/extension.js`.

## Read-only MCP server

`npm run build` also creates `out/mcp.js`, a stdio MCP server. Run **Baton: Copy
MCP Config** from the Command Palette to copy a ready-to-paste `mcpServers` JSON
snippet for the current workspace. The snippet sets `BATON_MEMORY_PATH` to the
extension's local `memory.json` and `BATON_PROJECT_ROOT` to the workspace folder.
The server reads `tasks.json` beside `memory.json` for the latest task whose
status is `planned`.
The sidebar's **Start MCP** button starts the built server and checks that its
tools respond; **Stop MCP** closes that local session. VS Code can also start its
registered MCP provider when a chat uses the tools.

The tools are `get_project_overview` (README introduction and file tree to depth 2),
`search_project_context(query)` (MiniSearch over saved memory), and
`get_active_plan` (latest saved planned task). They read current JSON on every
call and never modify it. VS Code versions with the MCP server provider API also
discover the server automatically; older versions can use the copied snippet.

## Honest limits

The sidebar shows Claude Code and Antigravity handoff buttons only when their
extensions are installed. The ChatGPT button opens the installed Codex extension
when present and otherwise opens ChatGPT in the browser. Codex and Antigravity
receive the copied prompt for manual pasting; Claude Code receives it in its
composer for review. Baton cannot read their responses; paste the plan back into
the sidebar. Codex execution goes through
the installed Codex CLI in a VS Code terminal, not a web chat or background API.
The extension does not infer that a terminal run finished successfully; run
tests and mark the outcome yourself. Live model routing needs working API keys
and access to the configured model tags. The rule router is a fallback, and its
keyword decisions can misclassify tasks; see the raw-risk evaluation table.

Context excludes `.env`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`,
`node_modules`, and `.git`, and skips files over 100 KB. Previewing context is
local; routing sends only the sources you keep selected, capped at 6,000
characters. Run actions require a trusted workspace.
