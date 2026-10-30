# OrdaX Orchestrator — generalist agent development (2026-10-29)

## Objective
Groq is the general-purpose **coordinator** of an authorized OrdaX workflow, not a story writer and not a second executor. The app provides tools, durable checkpoints, authority checks, receipts and evaluation. Tests across domains develop the system, its prompts, tool affordances and error handling; they do **not** update model weights or constitute fine-tuning.

## Canonical responsibilities
- Groq: interpret goal, decompose work, select next action among available capabilities, ask useful questions of GPT A/B, inspect witnessed replies, propose corrections and produce a synthesis.
- OrdaX App: authorize, dispatch, persist, observe, reconcile, enforce budgets and score deterministic requirements; never execute commands merely because Groq suggested them.
- GPT A/B: independent workers in their own conversations; untrusted responses require evidence.
- Evaluator: independent criterion checks, using observed receipts and artifacts; no self-certified quality based on the Groq summary.

## Generic acceptance contract
`product/src/mission-evidence.mjs` exports `evaluateMissionEvidence`. Requirements have stable IDs. Checks must reference a declared requirement, include method and evidence identifiers for decisions. Unknown criteria, duplicates and ungrounded passed/failed outcomes are rejected; missing checks remain `not_evaluated`. `verified` requires a confirmed execution plus every check passing. This pure contract has **no side effects** and does not alter existing mission finalization until explicitly integrated with trusted evidence owners.

**Important boundary:** an evidence ID is a *reference*, not evidence authentication. Before plugging this contract into a production state transition, resolve and attest every evidence ID from canonical Store/Run/receipt/artifact records. Only the App's trusted evaluators may construct checks. An LLM's arbitrary `passed` output cannot be accepted as independent verification.

## Progressive real E2E curriculum
1. Arithmetic and accounting: downstream worker receives an incorrect intermediate value; Groq must detect discrepancy from recomputation rather than confidently compound it.
2. Research and verification: conflicting claims and missing citations; preserve uncertainty, seek corroboration and reject fabrication.
3. Software engineering: reproduce bug, modify code, run regression suite, detect failing test and revise without speculative success reports.
4. Multi-conversation collaboration: independent GPT A and B produce incompatible proposals; Groq must compare assumptions, request reconciliation and consolidate evidence.
5. Workflow resilience: delayed hydration, navigation failure, 429, uncertain delivery, application restart and resume; prove exactly-once send safety and truthful diagnosis.
6. Long-horizon project: split work into milestones, persist checkpoint, continue across sessions without copying entire chat history; reject obsolete instructions.
7. Concurrent projects: run distinct goals without cross-project context or authorization leakage.
8. Nonfiction and creative work: structural and semantic rubrics with independent review; story mode is one workload, never the general policy.

For every workload record input, expected invariant, tools invoked, observed actions, receipt IDs, artifacts, failures, policy classification, cost, latency and outcome. Use adversarial fixtures in CI; then re-run with real GPT Web A/B and Groq for honest external validation. Never declare physical tests passed from simulated tests.

## Learning loop
Evaluate failure -> classify root cause -> change canonical app tooling, prompting or orchestration policy -> add regression -> verify with real external providers -> deploy via existing main and existing updater. Keep one store, one provider executor and one coordinator; no extra repo, parallel product, local duplicate install or hidden LLM memory.

## Current status
- Generic deterministic acceptance contract: implemented.
- Eight domain-labelled unit tests: executed locally, 8/8 passed.
- Production acceptance integration: **not done**.
- Trusted evidence-ID resolution: **not done**.
- Real cross-domain GPT Web/Groq E2E: **not done**.
- Model fine-tuning: **not done**, not implied by these changes.
