# Baton

Route a coding task from the Baton sidebar. Use **Baton: Set API Keys** to store
`GEMINI_API_KEY` and `OLLAMA_API_KEY` in VS Code SecretStorage. Empty inputs keep
existing keys.

Enter a task and click **Prepare context**. The collapsible **What will be shared**
preview lists each source and its snippet size in characters. Untick any source
to remove it from the displayed text and the router request, then click **Route task**.
Use **Refresh context** to capture newer editor or Git changes before routing.

Context includes the workspace README's first 3,000 characters, filtered Git status
and diff statistics, and the active file's selection or first 150 lines. The top
five matching memories appear first. Excluded paths and files over 100 KB are skipped;
context is trimmed to 6,000 characters after selection. No context is sent during preview.

The router tries Gemma in AI Studio, then Ollama Cloud, then local rules. Each
provider has an eight-second budget. Invalid JSON or a route that fails the Zod
schema advances to the next tier. Google retries without system instructions or
JSON mode when those options are rejected, within the same budget.

Routes are cached in memory by task text and selected context (up to 100 entries). Changing either
router key clears the cache. Policy runs on every result, including cache hits,
and can only raise risk. The sidebar shows the answering tier; the policy-adjusted
route and decision are saved in `tasks.json` under the extension's global storage.

Open **History** to see past tasks with their time, text, risk, router tier, and
status. Expand a task to inspect its routing details or paste a plan with **Import
plan**. The Task card and History both offer **Run in Codex**, **Mark done**,
**Show diff**, and **Run tests**.

**Run in Codex** is available for saved tasks whose policy permits RUN or CONFIRM.
CONFIRM displays the workspace path in a Run / Cancel modal and records approval
before execution. Running and completed tasks cannot launch again; route a new task
for another run. The extension rechecks policy, including the saved plan, before launch.

Install the CLI with `npm install -g @openai/codex` and sign in using `codex`.
If the CLI is unavailable, Baton offers **Copy prompt instead**. The prompt contains
the task, latest saved plan, and the context selected when routing. It is passed through
a temporary UTF-8 file to `codex exec --sandbox workspace-write` in **Baton: Codex**.
Windows uses PowerShell stdin; POSIX uses quoted file substitution. Temporary files
are removed after execution or terminal closure. Dedicated Baton terminals have a
30-minute limit. Closing the extension stops its terminals; it never infers completion.

**Show diff** opens Source Control. **Run tests** runs `npm test` in **Baton: Tests**
only when the saved workspace root has a readable `package.json` with `scripts.test`.
**Mark done** asks for Passed / Failed / Partial and saves the result and filtered
`git diff --name-only` filenames to History and searchable task memory. This is a
snapshot of unstaged tracked changes, including preexisting edits; untracked and
staged-only files are not included. Git failures still allow saving the outcome,
with a notice that changed files were unavailable. Previous free-text outcomes remain visible.

Tasks remember their original workspace. Reopen it to run workspace actions after
switching projects. Older tasks use the sole local folder or ask you to choose one.
Codex and test execution require a trusted workspace.

Imported plans and completed tasks are indexed by MiniSearch and saved to
`memory.json` in the extension's global storage after every addition. The search
index is rebuilt on load. Re-importing a task's plan replaces its earlier memory
entry. `MemoryStore` also accepts `decision` and `finding` items through its `add`
method; `search(query, k = 5)` returns ranked hits. Storage errors are reported and
do not silently overwrite unreadable memory.

To try plan recall:

1. Route “Add login rate limiting”.
2. In **History**, expand it and import a plan describing a token bucket for login attempts.
3. In **Task**, enter “Improve login rate limiting” and click **Prepare context**.
4. The preview should include a **Memory plan** source containing the imported plan.
   Unticking it removes that source from the router context. Reloading the extension
   preserves searchable plans; **Mark done** also saves a `task` memory item.

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

To verify execution, use a disposable Git repository with an existing tracked file
and a `package.json` test script. Route a concrete code change and confirm moderate
risk / CONFIRM. Cancel once and verify the task remains routed, then run it and
review the Codex terminal. Run tests, open Show diff, choose Mark done → Passed,
and reload History to verify the outcome, approval, and changed filenames persisted.
Also check that high-risk tasks cannot run and that a missing CLI offers prompt copying.
