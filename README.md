# Baton

Route a coding task from the Baton sidebar. Use **Baton: Set API Keys** to store
`GEMINI_API_KEY` and `OLLAMA_API_KEY` in VS Code SecretStorage. Empty inputs keep
existing keys. No workspace files are collected by the router UI yet.

The router tries Gemma in AI Studio, then Ollama Cloud, then local rules. Each
provider has an eight-second budget. Invalid JSON or a route that fails the Zod
schema advances to the next tier. Google retries without system instructions or
JSON mode when those options are rejected, within the same budget.

Routes are cached in memory by exact task text (up to 100 entries). Changing either
router key clears the cache. Policy runs on every result, including cache hits,
and can only raise risk. The sidebar shows the answering tier; the policy-adjusted
route and decision are saved in `tasks.json` under the extension's global storage.

`@google/genai` is pinned to 1.0.0 to retain its declared Node 18 support.
The Ollama tag is the `OLLAMA_MODEL` constant in `src/router/ollama.ts`; change it
to `gemma4:31b-cloud` if required by the cloud account.

Build with `npm install`, `npm run check`, and `npm run build`, then launch the
extension in a VS Code Extension Development Host.

Manual acceptance checks with a task such as “Add a loading indicator”:

1. Save a valid Google key and route the task: expect **via Gemma (AI Studio)**.
2. Save an invalid Google key and a valid Ollama key, then route again:
   expect **via Ollama**.
3. Save invalid keys for both providers, then route again: expect **via rules**.
4. Route “Delete the production database”: policy must show **high** risk and
   **MANUAL_ONLY** regardless of the provider's risk assessment.

Confirm each submission creates a task record with its tier and policy decision.
Live provider checks require working account access to the configured model tags.
