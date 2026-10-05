---
name: task-routing
description: Use Task Router's own roles and model candidates through pi-subagents-lean when explicitly requested.
disable-model-invocation: true
---

# Task Routing for Pi

This is the parent policy for Task Router's own `tr_*` agents. The executor is `@ssk_dev/pi-subagents-lean`, a facade over `@tintinweb/pi-subagents`, NOT nicobailon's `pi-subagents`. Do not substitute builtin personas. An assigned child follows its brief without activating this policy or delegating further.

Installation is not activation or delegation authority. Apply this policy only when the operator invokes `/skill:task-routing` or applicable instructions explicitly enable it. User instructions, project constraints and host permissions take precedence. Otherwise keep the existing workflow.

## Select a route

Read [the generated role map](references/role-map.md). Select its named candidate by task complexity, risk, context volume and economy, not always the strongest model. Give a short reason for a non-obvious choice.

Models and thinking are independent of the parent's current model. Explicit user choices override only their stated task/role scope. Prefer a matching candidate; an ad-hoc override keeps the original role and tools. Do not rewrite persistent configuration or silently substitute a model or thinking level.

Exact file/symbol locating stays light; bounded call-chain tracing needs more judgment; open-ended research across conflicting sources needs the relevant stronger candidate. Local versus network access is not itself a difficulty signal. Verification tier follows semantic risk and evidence needs, not diff size.

## Use only the roles needed

- The parent owns goal interpretation, direction, consequential decisions, integration and final acceptance.
- `tr_search` candidates resolve information gaps through local exploration and web/document research without modifying project files. Follow [the research evidence contract](references/research-evidence.md); summaries are navigation, not acceptance evidence.
- `tr_coding` candidates implement code/tests within supplied evidence, ownership and acceptance criteria, including small fixes. Batch related mechanical work.
- Every completed coding work unit needs independent `tr_verify` acceptance of the actual diff against the original criteria. Verifiers inspect, reproduce and run checks, but do not edit product/test sources. Follow [the coding contract](references/coding-quality.md), apply the repair limit and route fixes back to the coder.
- `tr_reasoning` candidates resolve a specifically escalated difficult judgment or high-risk review, without becoming another project manager.
- `tr_general` candidates deliver non-coding summaries, prose, structured information or analysis. New application/rendering code goes through coding.
- Tiny non-coding answers and known short reads can stay in the parent. Do not manufacture searches, stages or full-repository audits.

## Choose the current phase's shape

Before coordinating several children or a workflow phase, read [phase-level orchestration](references/orchestration.md) once. Choose execution shape separately from model tier. Check the actual available delegation operations before dispatch, not the host/plugin name. More than one agent, parallel work, multiple steps, and independent verification do not require a workflow.

If direct subagents and workflows are both available, prefer direct coordination for changing scope or short named assignments, and workflows for bounded stable phases with useful batching, pipeline overlap, reuse or aggregation. With direct subagents only, the parent coordinates all phases and dependencies through them. With workflows only, use short bounded phases and return evidence to the parent before deciding successors. With neither, keep eligible parent work here and report unavailable required delegation or acceptance.

Reassess at safe phase boundaries; do not lock the entire task into one shape. Preserve ownership, aggregate concurrency, exact routes, independent acceptance and the same work unit's repair limit. Honor supported user execution choices, report explicitly required unavailable modes, and follow the actual executor's schema. Do not transplant another plugin's API or change mode to bypass an infrastructure/permission failure.

## Preflight

Before first use, inspect the available operations and selected operation's installed schema. For lean, use `subagent({ op: "help", input: "run" })` when direct runs are available, or `input: "workflow"` for a workflow-only surface. `/agents` is the operator UI. There is no `action: list/models/doctor/guide` API. Check the selected flat `agents/tr_*.md` and any same-name definitions in the project's `.agents/agents/` and `.pi/agents/` (the latter wins). Refuse unexpected pins, tools, nested delegation or permissions. Reload after installation so the facade's startup type list is current.

Resolve an omitted provider from the ACTIVE parent provider, never a sibling candidate or a recommended startup model. Confirm the EXACT available `provider/id` and supported thinking in live Pi metadata or a current credential-free registry snapshot checked by Router doctor. `pi --list-models` lists available models without a model prompt, but does not establish thinking support. A stale snapshot is not current evidence. If exact availability/support cannot be established, report that blocker before relying on the route.

The engine permits fuzzy model/provider fallback and thinking clamping. Router does not: preflight exact IDs and inspect the actual child's resolved route before accepting its output. A mismatch is an infrastructure failure, not an acceptable substitute. Prefer `fallbackSubagent: "none"` and `strictAgentFiles: true` in `subagents.json`; do not change host settings silently.

Generated files deliberately omit model/thinking pins: direct calls cannot override frontmatter. The role map is authoritative and BOTH fields must be sent on every fresh launch. Calling only `subagent_type` would inherit the parent's model and is not Router routing. Direct launches use separate `model` and `thinking`; workflow `agent()` uses `model` and `effort`. Do not append `:thinking` to a model ID.

## Dispatch through lean

When direct runs are available, for each fresh direct child:

```js
subagent({
  op: "run",
  subagent_type: "tr_coding", // use the selected named candidate
  description: "Implement bounded behavior change",
  prompt: "Cold-start-complete brief with scope, evidence and acceptance criteria",
  run_in_background: true,
  input: JSON.stringify({ model: "provider/exact-id", thinking: "high" })
});
```

Use real registered models and configured thinking, not example placeholders. `input` must be a JSON object string; direct fields override duplicate keys in it. Do not use old `agent/task/context/async/action` fields.

Briefs include objective, repo/cwd/branch/ref, edit ownership, applicable project/global instructions, confirmed sources/interfaces, acceptance criteria, validation, expected report and stop conditions. `prompt_mode: replace` does NOT inherit AGENTS.md/CLAUDE.md. The parent reads and supplies relevant constraints; do not claim automatic inheritance or widen tools to compensate. Generated contexts are fresh with skills and nested delegation disabled.

Read [Pi execution](references/pi-execution.md) for either mode. In direct coordination, issue multiple `op: "run"` calls for independent work, use completion results to decide successors, and use supported steer/resume for focused follow-ups. This does not need an enclosing workflow.

When a scripted phase is selected, use one native lean `op: "workflow"` with `agent()/parallel()/pipeline()`, explicitly selecting `tr_*`, exact models and efforts. Do not use the separate Dynamic Workflows tool, old `runs.*`, or Codex dispatch tools. Respect the aggregate Router and stricter host concurrency limits across both modes.

Continue related work with its suitable known owner only after checking stored route, current definition, tools, cwd and baseline. Independent work and changed routes start fresh. Coder/verifier contexts are always independent.

Search exposes `web_access` from `@ssk_dev/pi-web-access-lean`, supporting search/check/fetch/get; no shell/edit/write. Reasoning also has no mutation tools. Verify has bash for checks but no edit/write: no-source-edit is policy, not an OS sandbox. Preserve permission-extension hooks; do not switch to foreground or disable extensions to bypass a setup failure.

Lean has no `contact_supervisor` channel. A blocked child reports the question and stops; the parent resolves it and resumes when eligible, rather than pretending a blocking supervisor request is pending.

On runner/provider/extension/tool failure, stop the affected lane and record the exact requested/effective route, run, cwd/worktree/branch/ref and partial diff. Retry only with a clear same-protocol brief. Never silently switch model, builtin role, external CLI or execution engine.

Finish when the deliverable and relevant acceptance checks are complete, or report the concrete blocker and unverified requirements. Execution completion and self-reports do not replace independent verification.
