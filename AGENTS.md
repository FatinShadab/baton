# Baton — Hackathon MVP Brief

Build a VS Code extension called **Baton** in TypeScript. Speed matters more than polish. Do not write tests unless asked. Use vanilla HTML/CSS/JS in the webview; no frameworks.

## Product flow

- The user types or speaks a coding task in a sidebar.
- A router uses Gemma 4 via Google AI Studio, falls back to Gemma via Ollama Cloud, then falls back to rules.
- The router returns a JSON route containing task type, risk tier, destination, and reason.
- A deterministic policy gate can only raise risk, never lower it.
- The user can either:
  - Open ChatGPT or Gemini with a context-rich prompt copied to the clipboard, then paste the plan back.
  - Run the task through Codex CLI (`codex exec`) in a VS Code terminal after confirmation.
- Save results and plans to local memory.

## Implementation constraints

- Bundle with esbuild.
- Use Node 18+ APIs, including global `fetch`, `FormData`, and `Blob`.
- Store keys in `context.secrets` (SecretStorage), never in settings or files.
- Persist data as JSON files under `context.globalStorageUri`.
- Never read or send `.env`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `node_modules`, or `.git`.
- Keep files small and give each file one responsibility. Use this layout:

```text
src/
  extension.ts
  types.ts
  secrets.ts
  store.ts
  router/
    rules.ts
    gemma.ts
    ollama.ts
    index.ts
  policy.ts
  context.ts
  memory.ts
  handoff.ts
  voice.ts
  codex.ts
media/
  panel.html
  panel.js
  panel.css
```

- Every external call must have a timeout and a try/catch. Failures fall through and never crash.

## Current instruction

Confirm understanding and save this brief to `AGENTS.md`. Wait for the user's next prompt before starting implementation.

<!-- Baton MCP instructions: start -->
## Baton project knowledge

When Baton MCP is connected, call `get_project_knowledge` for the project overview, active plan, recent history, and shared agent/model index. Use `search_combined_context` to search saved project memory and shared knowledge together.

For a task, call `get_task_context(task_id)` to read its saved request, planning prompt, plan, handoffs, and summaries. Use `get_task_prompt(task_id, kind, step_id)` for one planning or step handoff prompt. Use `baton_get_plan_summary`, `baton_list_summaries`, and `baton_get_step_summary` when you only need summaries. Call `get_agent_knowledge(agent_id)` for source-backed agent and model details.

Baton MCP tools are read-only. If they are unavailable, connect the stdio server using **Baton: Copy MCP Config**. Keep this project's existing instructions in force.
<!-- Baton MCP instructions: end -->
