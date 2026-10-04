---
name: task-routing
description: Use Task Router's own roles and model candidates through pi-subagents when explicitly requested.
disable-model-invocation: true
---

# Task Routing for Pi

This is the parent policy for Task Router's own `tr_*` agents. It uses pi-subagents only as the execution runtime; it does not select, override, or inherit Pi's builtin role personas. An assigned child follows its brief and does not activate this policy or delegate further.

Installation is not activation or delegation authority. Apply this policy only when the operator invokes `/skill:task-routing` or applicable instructions explicitly enable it. User instructions, project constraints, host permissions and capability ceilings take precedence. Outside its authorized scope, keep the existing workflow.

## Select a route

Read [the generated role map](references/role-map.md). It contains the configured named candidates, models, thinking levels, providers, selection hints and repair limit. Select by task complexity, risk, context volume and economy; do not default to the strongest model. Give a short reason for a non-obvious candidate.

The model and effort are independent of the parent's current model. An explicit user choice overrides only its stated task or role scope. Prefer an existing matching candidate; otherwise retain the original role and tools and apply a supported per-launch override. Do not rewrite persistent configuration for a one-off choice, silently substitute a model, or claim that prompt text changed a session's model.

Task shape sets the search tier. Exact file/symbol locating stays light; tracing a bounded call chain needs more judgment; open-ended research involving multiple sources, conflicting evidence or coverage needs the relevant stronger candidate. Local versus network access alone is not a difficulty signal. Verification tier follows semantic risk and evidence needs, not diff size.

## Use only the roles needed

- The parent keeps goal interpretation, direction, consequential decisions, integration and final acceptance.
- `tr_search` and its named candidates resolve information gaps through local exploration and web/document research. They return sources, coverage, contradictions and uncertainty without modifying project files. Their summaries are navigation, not acceptance evidence: follow [the research evidence contract](references/research-evidence.md) before important decisions.
- `tr_coding` and its named candidates implement code and tests within supplied evidence, scope and acceptance criteria, including small fixes. Batch related mechanical changes.
- Every completed coding work unit receives an independent `tr_verify` verdict against the actual diff and original acceptance criteria. Verification may inspect, reproduce and run relevant checks, but does not edit product code or test sources. Follow [the coding verification contract](references/coding-quality.md); apply the generated repair limit and route fixes back to the coder.
- `tr_reasoning` and its named candidates handle a specifically escalated difficult judgment or high-risk question. They remain bounded and do not become a second project manager.
- `tr_general` and its named candidates produce non-coding summaries, prose, structured information or analysis using existing tools. New rendering or application code goes through coding.
- Tiny non-coding answers and known short reads can stay in the parent. Do not manufacture searches, stages or a full-repository audit.

## Dispatch through pi-subagents

Before the first dispatch, call `subagent({ action: "list", capabilities: true })` and confirm the selected `tr_*` candidate is executable as a native Pi child with the expected tools. Inspect `subagent({ action: "models" })` and match the exact registry model ID. Project agents and settings overrides can shadow installed definitions; unexpected role/tool/runner changes are blockers, not permission to use a builtin substitute.

Resolve an omitted candidate provider from the active parent provider, not a sibling candidate or `subagents.defaultProvider`. Pass the exact `provider/id:thinking` on a fresh dispatch so settings and fuzzy matching cannot silently alter the model route. Dispatch `thinking` is NOT a standalone tool parameter: that field is watchdog-only. Check model-specific thinking support using the supplied catalog or available host metadata; do not treat accepted level names as proof of support or silently accept clamping. If support cannot be checked, disclose that limitation before relying on the requested level.

Use a direct `subagent({ agent: "tr_...", model: "provider/id:level", task: "...", context: "fresh", async: true })` for one bounded child. Give a cold-start-complete brief: objective, repo/cwd/ref, ownership and edit boundary, relevant sources and constraints, acceptance criteria, validation, expected output and stop/ask conditions.

For multi-step or parallel work, read [Pi execution](references/pi-execution.md) and the installed pi-subagents guide (`action: "guide", topic: "workflows"`). Use exactly one enclosing async pi-subagents workflow with children inside `runs.run`/`runs.all`. Do not use the separate Dynamic Workflows tool or removed Codex tools such as `spawn_agent`, `send_input` or `resume_agent`.

Continue related work with its suitable known owner after checking role, model/thinking, tools, cwd/worktree and current baseline. New independent work starts fresh. Fork only when most parent history is relevant and the host preserves the route. Coder and verifier must have independent contexts; do not fork the coder's reasoning into verification.

Search requires all four pi-web-access tools loaded in its background child. It has no bash/edit/write. Reasoning also has no shell or direct mutation tools. Verification has bash for checks but no edit/write: no-source-edit is a contract, not an OS sandbox. Do not grant tools or switch to foreground to bypass missing extensions or permissions.

A workflow, runner, provider, extension or tool setup failure is an infrastructure blocker. Stop the affected work, report the exact route/error/run/cwd/worktree/branch/ref and capture any partial diff before a clear same-protocol retry. Do not silently switch model, builtin role, external CLI or execution mode.

Finish when the requested deliverable and relevant acceptance checks are complete, or report the concrete blocker and unverified requirements. Parent checks and child self-reports do not replace independent verification.
