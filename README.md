# Baton

[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](https://github.com/FatinShadab/baton/releases)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-007ACC.svg)](https://code.visualstudio.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg)](https://www.typescriptlang.org/)

**Baton** orchestrates coding tasks into reviewed, context-aware handoffs across your favorite AI agents and tools. Inspired by the clean, keyboard-first Claude Code aesthetic, Baton coordinates a **multi-agent relay race**—routing tasks through Gemma 4, Ollama Cloud, or deterministic rules, passing structured implementation plans between ChatGPT, Gemini, Claude Code, Antigravity, and Codex CLI, and exposing full task context via the Model Context Protocol (MCP).

---

## 🚀 Key Features

- **🏃 Multi-Agent Relay Race UI:** Sequence tasks as legs in a collaborative relay race. Watch agent runners advance along an interactive straight-line track with real-time status indicators, agent inspection cards, and step completion gates.
- **🧭 Three-Tier Intelligent Routing:** Queries Gemma 4 via Google AI Studio, falls back to Gemma via Ollama Cloud, and cleanly defaults to deterministic local rules when offline.
- **🛡️ Deterministic Policy Gate:** Enforces security before code execution. The policy gate can only elevate risk (never downgrade it), requiring explicit user confirmation for high-impact changes.
- **📋 Structured Plan Extraction & Caching:** Extracts YAML-structured plans with SHA-256 hash caching, dependency DAG validation, parallel execution groups, and acceptance criteria.
- **🌐 Dual-Surface Workspace:** 
  - **Task Manager (Activity Bar):** Filter, resume, and switch between project tasks and race sessions.
  - **Main Coding Panel (Editor Area):** Full-featured split panel with floating prompt dock, live task output streaming, diff inspection, and resources tabs.
- **🔌 Built-In MCP Server:** Stdio Model Context Protocol server exposing project knowledge, active plans, task histories, and verified agent capabilities to external AI tools.
- **🎙️ Hands-Free Voice Input:** Transcribe spoken coding tasks via ElevenLabs integration with integrated microphone support.
- **🔒 Zero-Leak Privacy & Security:** API keys stored exclusively in VS Code `SecretStorage`. Sensitive files (`.env`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `.git`, `node_modules`) and files over 100 KB are strictly excluded from AI prompts and packaged distributions.

---

## 🏁 Quick Start

1. **Install and Activate:** Open the **Baton** icon in the Activity Bar or run `Baton: Open Chat Panel` from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. **Configure API Keys:** Open **Settings** in the Baton sidebar or run `Baton: Set API Keys`. Keys are saved directly to VS Code's encrypted SecretStorage:
   - `GEMINI_API_KEY`: For Gemma 4 routing via Google AI Studio.
   - `OLLAMA_API_KEY`: For fallback routing via Ollama Cloud.
   - `ELEVENLABS_API_KEY`: Optional, enables voice transcription.
3. **Start a Relay Race:** Type or speak your prompt in the floating dock. Review the auto-gathered workspace context, route the task, and pick your target agent (ChatGPT, Gemini, Claude Code, Antigravity, or Codex CLI).

---

## ⚡ Extension Commands

Access these commands at any time via the VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Title | Description |
| :--- | :--- | :--- |
| `baton.openEditor` | **Baton: Open Chat Panel** | Opens the primary Baton chat panel and relay workspace in the editor area. |
| `baton.newSession` | **Baton: New Task** | Starts a fresh relay session scoped to the active workspace project. |
| `baton.focus` | **Baton: Focus Task Manager** | Focuses the Baton sidebar session and task list in the Activity Bar. |
| `baton.setKeys` | **Baton: Set API Keys** | Prompts to securely store or update API keys in VS Code `SecretStorage`. |
| `baton.copyMcpConfig` | **Baton: Copy MCP Config** | Copies the project-scoped `mcpServers` configuration snippet to your clipboard. |
| `baton.kb.openSources` | **Baton: Open Knowledge Base Sources** | Opens `sources.json` to inspect verified external knowledge sources. |
| `baton.kb.openAvailability` | **Baton: Open Knowledge Base Availability** | Opens `availability.json` showing model capabilities and benchmark claims. |
| `baton.kb.previewSource` | **Baton: Preview Knowledge Base Source** | Fetches and renders a cached preview of a verified documentation source. |
| `baton.kb.update` | **Baton: Update Knowledge** | Triggers an asynchronous update of verified knowledge-base claims. |
| `baton.kb.showCandidates` | **Baton: Show Knowledge Base Candidates** | Inspects proposed knowledge claims pending verification. |
| `baton.kb.resetStats` | **Baton: Reset Stats** | Clears cached routing hit counts and usage statistics. |

---

## 🎯 Planning & Execution Destinations

Baton smoothly transitions prompts and execution across agents:

| Destination | Mechanism | Description |
| :--- | :--- | :--- |
| **ChatGPT** | Browser Handoff | Opens ChatGPT in VS Code's integrated browser with the prompt pre-copied. |
| **Gemini** | Browser Handoff | Opens Gemini in VS Code's integrated browser with the prompt pre-copied. |
| **Claude Code** | Extension Bridge | When the Claude Code extension is installed, opens its composer with the prompt preloaded. |
| **Antigravity** | Extension Bridge | Focuses the Antigravity assistant panel and copies the contextual planning prompt. |
| **Codex CLI** | Terminal Execution | Runs an approved task using `codex exec` in an integrated VS Code terminal with live diff inspection. |

> **Browser Fallback:** If sign-in is blocked in VS Code's internal browser, click **Open externally** to complete the handoff in your default system browser.

---

## 🛠️ Model Context Protocol (MCP) Server

Baton bundles a high-performance stdio MCP server at `out/mcp.js`. External AI assistants (Cursor, Claude Desktop, Antigravity, etc.) can discover and query Baton's task state and knowledge base.

To connect your external client, run **Baton: Copy MCP Config** and paste the snippet into your client's settings.

### Available MCP Tools

| Tool | Purpose |
| :--- | :--- |
| `get_project_knowledge` | Returns project overview, active plan, recent history, and shared agent index in a single call. |
| `get_project_overview` | Returns README summary, saved preferences, constraints, and shallow directory structure. |
| `search_project_context(query)` | Searches saved workspace memories and architectural decisions. |
| `get_active_plan` | Fetches the current task with `planned` status. |
| `get_project_history` | Lists the 20 most recent saved tasks with statuses and summaries. |
| `get_task_context(task_id)` | Complete task dossier: request, planning prompt, plan, handoffs, and step summaries. |
| `get_task_prompt(task_id, kind, step_id?)` | Retrieves specific planning or individual step handoff prompts. |
| `baton_get_step_summary` | Inspects step-level progress summaries and acceptance verification. |
| `baton_list_summaries` | Lists all structured step summaries for a task. |
| `baton_get_plan_summary` | Returns parsed YAML step definitions and dependency graph. |
| `get_agent_knowledge(agent_id)` | Returns source-backed capabilities and model claims for a specific agent. |
| `search_knowledge_base(query)` | Searches shared model knowledge with citations and verification timestamps. |
| `search_combined_context(query)` | Searches both project memories and agent knowledge in a unified query. |

---

## 🔐 Security & Privacy Architecture

- **Encrypted Credentials:** API keys are never written to disk, settings files, or task logs. They reside in VS Code's OS-keychain-backed `SecretStorage`.
- **Zero-Leak Context Pruning:** Before sending any context to an AI router, Baton automatically filters out `.env`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `.git`, `node_modules`, and files over 100 KB.
- **Review Before Send:** You can inspect and uncheck any auto-gathered file excerpts before the request leaves your machine.
- **Isolated Session State:** Task outputs, terminal buffers, and plans are scoped per session and project under `context.globalStorageUri`.

---

## 💻 Development & Packaging

### Prerequisites
- VS Code `1.85.0` or newer
- Node.js `18.x` or newer and `npm`
- (Optional) [Codex CLI](https://github.com/openai/codex) for terminal execution

### Build from Source
```sh
# Install dependencies
npm install

# Typecheck TypeScript source
npm run check

# Bundle extension and MCP server
npm run build

# Run unit and integration tests (20 suites)
npm test

# Run routing benchmark evaluation
npm run eval

# Package into a deployable .vsix extension bundle
npm run package
```

### Debugging in VS Code
Press `F5` (or select **Run Baton** in Run and Debug) to launch an **Extension Development Host** with Baton loaded.

---

## 📄 License

This project is licensed under the [Apache License, Version 2.0](LICENSE).
