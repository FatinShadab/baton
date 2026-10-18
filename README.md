# Baton

Baton is a VS Code extension for turning a coding request into a reviewed, context-aware handoff. Describe a task in the sidebar, choose what project context to share, and see a structured route with a task type, risk tier, destination, and reason. Baton keeps plans and outcomes in local extension storage so later tasks can use relevant project history.

The router tries Gemma 4 through Google AI Studio, then Gemma through Ollama Cloud, then local rules. A separate, deterministic policy gate can raise the route's risk level but cannot lower it. Execution always remains a deliberate user action.

## Features

- **Reviewable context:** Preview the README summary, Git change summary, active editor excerpt, and relevant saved memories. Remove sources before routing.
- **Visible routing:** See whether Gemma, Ollama, or rules answered, along with the selected destination, risk, and policy action.
- **Planning handoffs:** Prepare a prompt for ChatGPT, Gemini, and supported installed VS Code coding assistants. Paste the resulting plan back into Baton to save it.
- **Terminal execution:** Run an approved task with `codex exec` in a VS Code terminal, inspect the diff, and record the outcome.
- **Read-only MCP tools:** Expose project overview, saved context, and the active plan to compatible MCP clients.
- **Voice input:** Transcribe a spoken task when an ElevenLabs API key is configured.

## Requirements and setup

- VS Code 1.85 or newer.
- Node.js 18 or newer and npm to build the extension.
- [Codex CLI](https://github.com/openai/codex) installed and signed in to use **Run in Codex**. Planning and routing do not require the CLI.

```sh
npm install
npm run build
```

Open this repository in VS Code and press **F5**, or select **Run Baton** in Run and Debug. The launch profile builds the extension and opens an Extension Development Host in the current repository. Select the Baton icon in the Activity Bar to open its sidebar.

After editing TypeScript or webview files, rebuild with `npm run build` and reload the Development Host. `npm run check` runs the TypeScript check.

## Configure API keys

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

1. **Describe the task.** Type in the sidebar or use voice input. An ordinary task uses the open workspace.
2. **Prepare context.** Review the source preview and deselect anything you do not want in the routing request. Baton sends only selected context, capped at 6,000 characters.
3. **Route task.** Review the answering router, destination, risk, reason, and policy action. Model responses are validated before use; the policy gate runs after routing.
4. **Prepare and save a plan.** Choose a planning handoff, review the generated prompt, and paste the assistant's plan into **Implementation Plan**. Save it in Baton.
5. **Run and record the result.** If appropriate, choose **Run in Codex**, confirm when required, inspect the terminal and **Show diff**, then **Mark done** to save the outcome.

### Planning destinations

| Destination | Baton handoff |
| --- | --- |
| ChatGPT / Codex | Opens the installed OpenAI Codex VS Code extension when available and copies the prompt for pasting. Otherwise opens ChatGPT in a browser. |
| Gemini | Opens Gemini in a browser with the prompt copied for pasting. |
| Claude Code | When its VS Code extension is installed, opens it with the prompt placed in its composer for review. |
| Antigravity | When its VS Code extension is installed, opens its panel and copies the prompt for pasting. |

Claude Code and Antigravity controls appear only when their extensions are detected. Baton does not read responses from those assistants; paste a plan back into the sidebar. **Run in Codex** uses the Codex CLI in a VS Code terminal, and Baton does not automatically infer whether that terminal run succeeded.

## MCP server

`npm run build` creates the stdio server at `out/mcp.js`. The sidebar's **Start MCP** button starts a local session and checks that the tools respond; **Stop MCP** closes it. Compatible VS Code versions can discover Baton's registered MCP provider. **Baton: Copy MCP Config** copies an `mcpServers` JSON snippet for an external client or a VS Code version that needs manual configuration.

| Tool | Returns |
| --- | --- |
| `get_project_overview` | README introduction and a shallow project file tree |
| `search_project_context(query)` | Relevant saved project memories |
| `get_active_plan` | The latest saved task with `planned` status |

The MCP tools are read-only. The copied configuration points the server to the current workspace and Baton's local memory files.

## Data and security

Baton saves tasks, plans, outcomes, and memory as JSON under VS Code's `context.globalStorageUri`. Context preparation is local; routing sends the selected excerpt to the active model provider. Sensitive paths and data are excluded from context, including `.env`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `node_modules`, and `.git`; files over 100 KB are skipped. Running a task requires a trusted workspace and any confirmation required by the policy gate.

## Demo and development

The **Demo task** button explicitly selects the bundled [`demo-repo`](demo-repo). It is separate from ordinary tasks, which use the open workspace. In the demo project, `npm test` shows a failing date parser test to use for a complete routing, planning, execution, and review walkthrough.

To run the standalone routing evaluation, use `npm run eval`. It writes [`eval-results.md`](eval-results.md); the labeled cases are in [`scripts/eval.ts`](scripts/eval.ts). Live Gemma evaluation requires a `GEMINI_API_KEY` process environment variable. Without one, live model results are marked unavailable.

The extension is written in TypeScript and bundled with esbuild. Its sidebar uses vanilla HTML, CSS, and JavaScript in `media/`; the extension services live in `src/`.
