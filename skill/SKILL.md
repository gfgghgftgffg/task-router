---
name: task-routing
description: Route delegated work by model when the task-routing profile is active or explicitly requested.
---

# Task Routing

Use this policy as the coordinating parent. A child with an assigned role follows its bounded assignment and does not orchestrate further children. User instructions and host permissions take precedence; this skill does not authorize additional external actions.

Read [the generated role map](references/role-map.md) once when delegating. It lists each role's default candidate, its alternative candidates, reasoning efforts, providers, role names, and repair limits. Every candidate is registered as its own named role: `tr_<role>` for the default and `tr_<role>_<option>` for each option. Choose the lightest candidate that still satisfies the difficulty, risk, context volume, and any option hint, and give a one-line reason when the choice is not the obvious default; the default is not automatically the strongest. An explicit user model or effort instruction overrides the corresponding default only for the specified task or role; preserve other defaults and do not rewrite persistent configuration. Selecting the parent model alone does not override child settings, and a prompt cannot change the current session's model: per-spawn selection only works through the host's exposed selector. New user requirements may justify re-judging the choice among the authorized candidates; record the reason. When a candidate fails, first separate infrastructure, missing context, and implementation problems, then address the cause. Do not escalate on every error or outside the authorized candidates. Read only the selected role's contract when explicit role instructions are needed.

Task shape sets the search tier; access mode does not. Read-only is a permission boundary, not a difficulty signal. Exact locating such as `rg`/`grep` over known strings or symbols stays light even across many files; bounded understanding such as limited repository navigation, a call chain for a well-defined question, or one documentation topic needs more judgment; open-ended research with multiple sources, conflicts, or coverage requirements needs a candidate suited to deep research, selected from the role map. Network access alone does not raise the tier, and local code can be complex too. For verification, rank candidates by semantic risk and the evidence the change needs, not diff size. The parent reads a known short path directly instead of spawning a child for every grep. When the hard part is requirement or evidence judgment, the parent states the scope first and switches to another authorized candidate only if that remains necessary; a network or tool error is not by itself an upgrade signal.

## Choose the work unit

- Keep goal interpretation, overall direction, and consequential decisions in the parent.
- Delegate discovery, repeated reading, source research, and log investigation to `search`. Give it questions and constraints, not a query-by-query itinerary; independent questions can go to separate search children. Its summary is a navigation aid: the parent reads the complete relevant source material before adopting consequential conclusions or directing dependent work. Follow [the research evidence contract](references/research-evidence.md) when using research results; send focused follow-ups to the same child for gaps.
- Delegate code changes, including small fixes and test implementation, to `coding`. Batch nearby mechanical edits. Supply sufficient evidence and acceptance criteria; do not make the parent write a complete implementation first.
- Every completed coding work unit receives an independent `verify` verdict, including small edits. A mechanical change may need only a brief diff check; the parent's own check does not replace this verdict. The verifier may run tests but sends source changes back through the parent to `coding`.
- Use `general` for substantial non-code deliverables and analysis of supplied material. If custom HTML or another coded presentation is required, settle its factual content here before assigning rendering code to `coding`; using an existing renderer does not itself require a coder.
- Use `reasoning` only when a bounded difficult question or independent high-risk review warrants another strong-model context. The parent may decide directly when it already has the relevant evidence.
- Answer tiny non-code questions and perform known-path reads directly when delegation would cost more than it saves. Do not trigger research merely because a file must be read.

Role, difficulty, risk, and context volume are different properties. A small authentication change still deserves risk-aware verification. A large batch of well-specified mechanical edits can stay with a lightweight candidate. Only create the roles this task needs.

Security, data-integrity, and concurrency risks require the parent's attention, not an automatic extra reasoning agent. Escalate independently when a specific unresolved question or the need for a second judgment justifies it.

## Choose the current phase's shape

Before coordinating several children or a workflow phase, read [phase-level orchestration](references/orchestration.md) once. Choose execution shape separately from model tier. Check the actual available delegation operations before dispatch, not the host/plugin name. More than one agent, parallel work, multiple steps, and independent verification do not require a workflow.

If direct subagents and workflows are both available, prefer direct coordination for changing scope or short named assignments, and workflows for bounded stable phases with useful batching, pipeline overlap, reuse or aggregation. With direct subagents only, the parent coordinates all phases and dependencies through them. With workflows only, use short bounded phases and return evidence to the parent before deciding successors. With neither, keep eligible parent work here and report unavailable required delegation or acceptance.

Reassess at safe phase boundaries; do not lock the entire task into one shape. Preserve ownership, aggregate concurrency, exact routes, independent acceptance and the same work unit's repair limit. Honor supported user execution choices, report explicitly required unavailable modes, and follow the actual executor's schema. Do not transplant another plugin's API or change mode to bypass an infrastructure/permission failure.

## Dispatch and continue

Before dispatching, prefer the existing owner of the same work line after checking project, worktree, scope, role, model/effort, provider, permissions, and current code baseline. Normal commits, repairs, and incremental baseline changes that can be clearly explained and checked do not require a new agent. Start a new context when the old one is unrelated, too stale to refresh locally, or too noisy for the work. For native direct children, continue related work through their known ID with `send_input` when supported. In another execution mode, use its actual continuation controls; do not assume it accepts native child IDs. Keep owner/ID in the parent's current working context; no registry file is required.

Check the exposed tool schema on each dispatch. Prefer its explicit named-role selector, applying supported model/effort overrides when the user requested them. Otherwise pass the effective model and effort with the role contract, only if the host supports that model and preserves the required provider and permissions. If the requested combination is unsupported, report that limitation rather than silently using the role default. Do not invent tool parameters or claim a prompt changed the parent session's model.

A new child's brief states the goal, scope/ownership, constraints, acceptance criteria, confirmed files/symbols and interface constraints, current changes or baseline, unresolved questions, and necessary original sources. Prefer existing README, module documentation, and source indexes as shared navigation; consider a short project index with version and applicability only when navigation is missing. Facts can become stale: check affected originals under the research evidence contract before relying on them.

Run independent research, non-code and development units concurrently when the selected executor supports it, including several children in the same role. In direct-subagent mode, use the exposed native spawn capability. Read [the parallel work contract](references/parallel-work.md) for native direct-child reuse, resume, context, isolation and integration; reuse the loaded guidance while it remains unchanged. In workflow mode, follow the available executor's schema and lifecycle rather than assuming direct spawn or send_input exists.

For code changes, use [the coding verification contract](references/coding-quality.md). For research-only and non-code tasks, do not load that contract or force a coding/testing/review pipeline.

If a role is unavailable, report which route failed and why. Continue independent authorized work, but do not claim the blocked part completed or substitute a model without the user's direction. Do not relax sandbox or approval settings to get a route working.

Finish when the requested deliverable and relevant acceptance checks are complete, or state the concrete unresolved blocker. Do not stop at the first implementation, insert routine approval checkpoints, or add unrelated audits, full-suite reruns, and speculative improvements.
