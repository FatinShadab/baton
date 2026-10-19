# 🪄 BATON — PITCH DECK
> **Orchestrate Your AI Relay: Maximum Output, Zero Quota Burnout.**

---

## Slide 1: The Hook & Title
### **BATON**
**Pass the prompt. Spare the quota. Ship the code.**

- **The Big Idea:** You don’t need a \$200/month subscription to build like a 10x engineer. You need an intelligent traffic controller for the AI tools you already own.
- **Category:** Agent Orchestration & Context Handoff Engine for VS Code.

---

## Slide 2: The Dual Dilemma
### **The \$200 Subscription Trap vs. The 5-Hour Wall**

```
┌─────────────────────────────────────────┐    ┌─────────────────────────────────────────┐
│           THE BOOTSTRAPPER PAIN         │    │           THE PRO USER WALL             │
├─────────────────────────────────────────┤    ├─────────────────────────────────────────┤
│ • $20–$200/month subscriptions per tool │    │ • You hit the "5-hour rate limit"       │
│ • Too expensive for students & indies   │    │   right in the middle of deep flow      │
│ • Burning enterprise tokens on basic js │    │ • Expensive reasoning models wasted     │
│   formatting and docstrings             │    │   on trivial boilerplate tasks          │
└─────────────────────────────────────────┘    └─────────────────────────────────────────┘
```

> **The Reality:** Developers are either priced out of frontier AI, or locked out of it when they need it most.

---

## Slide 3: The Hidden Arsenal
### **You Already Have an Army of Agents. You’re Just Fighting Them.**

Look at what an average developer already has access to today:
- **Free Web Powerhouses:** ChatGPT (GPT-4o Free), Gemini 2.5 Flash / Pro web tier, Claude.ai free tier.
- **IDE Companions:** Antigravity, GitHub Copilot, Codex CLI, Muse.
- **Fast / Local Edge:** Google AI Studio (Gemma), Ollama Cloud, local open weights.

**The Irony:** You have more compute power on your desktop than a 2020 tech giant, but switching between them feels like carrying water in a leaky bucket.

---

## Slide 4: The Core Principle
### **The 60-30-10 Rule of Model Compute**

AI architecture leaders agree: **Not all tasks deserve a frontier model.**

```
                 ▲
                / \
               / 10\  ← 10% High-Impact / Critical Architecture (Frontier Models: o3, Claude 3.7)
              /-----\
             /   30  \  ← 30% Moderate Logic / Refactoring / Planning (Mid-Tier / Free Web LLMs)
            /---------\
           /    60     \  ← 60% Routine / Boilerplate / Triage (Fast, Sub-Cent / Free Gemma & Rules)
          /-------------\
```

- **60% Routine / Simple Tasks:** Formatting, regex, basic extraction, summaries, test scaffolding → *Handled by sub-cent, instant models (Gemma, rules, local).*
- **30% Moderately Complex Tasks:** Refactoring functions, component architecture, drafting test plans → *Handled by mid-tier models & free web assistants.*
- **10% High-Impact Decisions:** Deep debugging, critical edge cases, security audits → *Reserved for frontier models.*

> **The Mistake:** Devs burn their precious 10% frontier quota asking for a date formatting helper!

---

## Slide 5: The Breakdown
### **Two Critical Bottlenecks Kill Multi-Agent Workflows**

1. **Routing Paralysis (Token & Time Inefficiency):**
   * *“Which agent should do this task?”*
   * Picking the wrong model wastes frontier tokens, clutters context, or yields poor code.
2. **The Context Hand-off Nightmare (Context Amnesia & Secret Leaks):**
   * Manually copy-pasting code snippets across browser tabs is slow, messy, and error-prone.
   * Accidental leakage of `.env`, SSH keys, and proprietary credentials.
   * Zero memory: Agent B has no idea what Agent A just planned or executed.

---

## Slide 6: The Solution
### **Enter Baton: The AI Relay Layer for VS Code**

**Baton** is an open-source VS Code extension that dynamically routes coding tasks, safeguards sensitive context, and passes structured handoffs between your local editor, web LLMs, and CLI runners.

```
                   [ Developer Task: Type or Voice ]
                                   │
                                   ▼
                   ┌───────────────────────────────┐
                   │  Baton Privacy Context Engine │  (Excludes .env, keys, git, 100KB+ files)
                   └───────────────┬───────────────┘
                                   │
                        ┌──────────┴──────────┐
                        ▼                     ▼
              [ Cascading Router ]   [ Policy Safety Gate ]
              • Gemma 4 (AI Studio)  • Deterministic Guardrail
              • Gemma (Ollama Cloud) • Only raises risk
              • Local Rules Fallback • Never lowers it
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
  [ Planning Handoff ]         [ Terminal Execution ]
  • Clean 1-Click Clipboard    • Codex CLI (`codex exec`)
  • ChatGPT / Gemini / Claude  • Diff review & verification
  • Antigravity IDE Panel      • Recorded to Local Memory & MCP
```

---

## Slide 7: Why Baton Is Unique
### **Built for Privacy, Speed, and Zero Vendor Lock-in**

| Capability | Monolithic Assistants ($20–$200/mo) | Manual Copy-Paste | **Baton** |
| :--- | :--- | :--- | :--- |
| **Cost Efficiency** | Fixed monthly cost, easy rate limits | Free, but high cognitive load | **Maximizes free & cheap tiers (60-30-10)** |
| **Routing Intelligence** | 1 model fits all (expensive) | Guesswork | **Cascading Gemma → Ollama → Rules** |
| **Context Sanitization**| Sends full repo blindly | Human error leaks `.env` | **Strict local filter (excl. secrets & `.env`)** |
| **Cross-Agent Memory** | Siloed in proprietary cloud | None | **Local MiniSearch + Read-Only MCP Server** |
| **Execution Safety** | Auto-runs without gate | Manual inspection | **Deterministic Policy Gate + Terminal review** |

---

## Slide 8: The Handoff in Action (Product Flow)

1. **Describe:** Type or speak (Voice STT via ElevenLabs) your task inside VS Code.
2. **Sanitize:** Baton curates active editor lines, git status, and relevant project memories, capping at 6,000 characters.
3. **Route:** Classifies risk (`LOW`, `MODERATE`, `HIGH`) and recommends destination in milliseconds.
4. **Handoff:** 
   - **For 30% Planning:** Click *Plan in ChatGPT* or *Plan in Gemini* → Formatted prompt copied + browser opens automatically.
   - **For 60% Execution:** Run via Codex CLI terminal or local agent.
5. **Memory Loop:** Paste the plan back into Baton. It indexes into local memory and exposes it via **MCP** to Antigravity and any MCP-compatible agent.

---

## Slide 9: The Impact & ROI
### **10x Efficiency. Zero Wasted Dollars.**

- **Eliminate 5-Hour Lockouts:** Offload 60% of routine tasks to free/instant models, saving frontier bandwidth for when it actually counts.
- **\$0 Subscriptions Needed:** Build with the speed of an enterprise tier using free web models and fast API micro-calls.
- **Enterprise-Grade Safety:** Deterministic policy gate prevents unauthorized high-risk operations (e.g., dropping databases or deleting files).
- **Connected Ecosystem:** Bridges Antigravity, Copilot, ChatGPT, Gemini, and Codex CLI into one coherent relay team.

---

## Slide 10: The Vision
### **The Future Isn’t One Monolithic Model. It’s an Orchestrated Relay.**

> *"The fastest runners don't run 400 meters alone. They pass the baton."*

- **Status:** Functional VS Code MVP, bundled with esbuild, native MCP server, sub-second routing.
- **Next Step:** Expand agent adapters, automated clipboard return hooks, and community routing policies.

**Take back control of your AI workflow. Pass the Baton.**
