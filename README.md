# Baton

Baton is a VS Code extension for turning a coding request into a reviewed, context-aware handoff. Inspired by the clean, focused Claude Code interface, Baton features a dual-surface architecture: a **Session Manager** in the Activity Bar sidebar to navigate past coding sessions, and a full-featured **Main Coding Panel** in the editor area with a warm charcoal aesthetic, floating prompt dock, and integrated tabs for Chat, History, Settings, and MCP.

The router tries Gemma 4 through Google AI Studio, then Gemma through Ollama Cloud, then local rules. A separate, deterministic policy gate can raise the route's risk level but cannot lower it. Execution always remains a deliberate user action.

## Features

- **Dual-surface UI:** A dedicated **Session Manager** in the VS Code sidebar (`+ New session`, filterable past sessions) and an expansive **Main Coding Panel** in the editor area.
- **Claude Code aesthetic:** Warm charcoal & terracotta palette, retro 8-bit mascot hero state, and pinned floating prompt dock.
- **Reviewable context:** Preview the README summary, Git change summary, active editor excerpt, and relevant saved memories. Remove sources before routing.
- **Visible routing:** See whether Gemma, Ollama, or rules answered, along with the selected destination, risk, and policy action.
- **Planning handoffs:** Prepare a prompt for ChatGPT, Gemini, and supported installed VS Code coding assistants. Paste the resulting plan back into Baton to save it.
- **Terminal execution:** Run an approved task with `codex exec` in a VS Code terminal, inspect the diff, and record the outcome.
- **Integrated MCP tools:** Toggle Baton's local MCP server, copy client configurations, and inspect status directly in the main panel.
- **Voice input:** Transcribe a spoken task via ElevenLabs using the top header microphone button.

## Requirements and setup

- VS Code 1.109 or newer.
- Node.js 18 or newer and npm to build the extension.
- [Codex CLI](https://github.com/openai/codex) installed and signed in to use **Run in Codex**. Planning and routing do not require the CLI.

```sh
npm install
npm run build
```

Open this repository in VS Code and press **F5**, or select **Run Baton** in Run and Debug. The launch profile builds the extension and opens an Extension Development Host in the current repository. Select the Baton icon in the Activity Bar to open its sidebar.

After editing TypeScript or webview files, rebuild with `npm run build` and reload the Development Host. `npm run check` runs the TypeScript check.

## Configure API keys

Open **Settings** in the Baton sidebar to paste your own Google AI Studio (Gemma) or ElevenLabs key. Each key is stored in VS Code SecretStorage and takes priority over the corresponding default key. The panel shows whether your key is active, but never displays it after saving. Use **Remove** to return to the default key. This lets you continue with your own quota if a default key reaches its limit.

Use **Baton: Set API Keys** in the Command Palette. Baton stores keys in VS Code SecretStorage, not in extension settings or task history. Leaving a prompt empty keeps the existing value.

| Key | Used for |
| --- | --- |
| `GEMINI_API_KEY` | Primary Gemma 4 route through Google AI Studio |
| `OLLAMA_API_KEY` | Fallback Gemma route through Ollama Cloud |
| `ELEVENLABS_API_KEY` | Optional voice transcription |

For **F5 development**, the Extension Development Host also imports these keys from this repository's ignored `.env` file into SecretStorage when Baton activates. For example:

```dotenv
GEMINI_API_KEY=your_key
OLLAMA_API_KEY=your_key
ELEVENLABS_API_KEY=your_key
```

Reload the Development Host after changing `.env`. This import is a development convenience; the file itself is excluded from task context. If neither model service is available, Baton explains the failure and uses local rules. A rules result is not presented as a Gemma result.

## Use Baton

1. **Describe the task.** Type in the sidebar or click the mic to record in a VS Code integrated browser tab. An ordinary task uses the open workspace.
2. **Prepare context.** Review the source preview and deselect anything you do not want in the routing request. Baton sends only selected context, capped at 6,000 characters.
3. **Route task.** Review the answering router, destination, risk, reason, and policy action. Model responses are validated before use; the policy gate runs after routing.
4. **Prepare and save a plan.** Choose a planning handoff, review the generated prompt, and paste the assistant's plan into **Implementation Plan**. Save it in Baton.
5. **Run and record the result.** If appropriate, choose **Run in Codex**, confirm when required, inspect the terminal and **Show diff**, then **Mark done** to save the outcome.

### Planning destinations

| Destination | Baton handoff |
| --- | --- |
| ChatGPT | Opens ChatGPT in VS Code's integrated browser with the prompt copied for pasting. |
| Gemini | Opens Gemini in VS Code's integrated browser with the prompt copied for pasting. |
| Claude Code | When its VS Code extension is installed, opens it with the prompt placed in its composer for review. |
| Antigravity | When its VS Code extension is installed, opens its panel and copies the prompt for pasting. |

The sites handle their own sign-in. If sign-in is blocked in VS Code, use **Open externally** in the sidebar; Baton never switches browsers automatically. Browser sign-in persistence follows VS Code's `workbench.browser.dataStorage` setting, and untrusted workspaces use ephemeral sessions. The voice recorder requests microphone permission in the integrated browser and returns the transcript to Baton. Claude Code and Antigravity controls appear only when their extensions are detected. Baton does not read responses from those assistants; paste a plan back into the sidebar. **Run in Codex** uses the Codex CLI in a VS Code terminal, and Baton does not automatically infer whether that terminal run succeeded.

## MCP server

`npm run build` creates the stdio server at `out/mcp.js`. The sidebar's **Start MCP** button starts a local session and checks that the knowledge base responds; **Stop MCP** closes it. VS Code can discover one Baton MCP server per local workspace folder. **Baton: Copy MCP Config** copies an `mcpServers` JSON snippet for an external MCP client, scoped to the active editor's project (or the first folder). Copy it again after switching projects. The copied configuration includes the extension installation path and global storage path; keep it local and copy a fresh one after moving or reinstalling the extension. Starting MCP or copying its config creates `AGENTS.md` if absent; when one already exists, Baton adds or updates only its marked MCP section.

| Tool | Returns |
| --- | --- |
| `get_project_knowledge` | One-call project overview, active plan, recent history, and shared knowledge index |
| `get_project_overview` | README introduction, saved project constraints and preferences, and a shallow file tree |
| `search_project_context(query)` | Relevant saved project memories |
| `get_active_plan` | The latest saved task with `planned` status |
| `get_project_history` | The 20 most recent saved tasks for the project, with status and plan summaries |
| `get_knowledge_base_overview` | Shared agent and model index, IDs, and verification dates |
| `get_agent_knowledge(agent_id)` | Full knowledge and source-backed claims for one agent and its models |
| `search_knowledge_base(query)` | Ranked shared knowledge hits with source URLs |
| `search_combined_context(query)` | Project memory and shared knowledge hits in one response |
| `get_task_summary(taskId)` | Saved finish summary for a project task |
| `get_task_context(task_id)` | Saved request, planning prompt, full plan, handoffs, step summaries, and finish summary |
| `get_task_prompt(task_id, kind, step_id?)` | A planning prompt or one step handoff prompt |
| `baton_get_step_summary`, `baton_list_summaries`, `baton_get_plan_summary` | Step and plan summaries for a project task |

The MCP tools are read-only. Each server uses its project root to filter Baton's shared `tasks.json` and `memory.json` and to locate structured task summaries. Agent and model knowledge is shared across projects: bundled `kb/agents.seed.json` is combined with saved `kb.json`, with saved entries taking precedence. An external client's copied configuration keeps the project root it had when copied.

## Data and security

Baton saves tasks, plans, outcomes, and memory as JSON under VS Code's `context.globalStorageUri`. Context preparation is local; routing sends the selected excerpt to the active model provider. Sensitive paths and data are excluded from context, including `.env`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `node_modules`, and `.git`; files over 100 KB are skipped. Running a task requires a trusted workspace and any confirmation required by the policy gate.

## Development

To run the standalone routing evaluation, use `npm run eval`. It writes [`eval-results.md`](eval-results.md); the labeled cases are in [`scripts/eval.ts`](scripts/eval.ts). Live Gemma evaluation requires a `GEMINI_API_KEY` process environment variable. Without one, live model results are marked unavailable.

The extension is written in TypeScript and bundled with esbuild. Its sidebar uses vanilla HTML, CSS, and JavaScript in `media/`; the extension services live in `src/`.
