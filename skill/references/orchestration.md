# Phase-level orchestration

This is the coordinating parent's policy when Task Router is active, not a new scheduler or an automatic task classifier. Select model candidates under the role map separately from execution shape. Task difficulty, number of agents, and number of steps do not select an execution mode on their own.

## Check host capabilities first

The shapes below are optional capabilities, not prerequisites for delegation. Inspect the active tool operations, help/schema, available role/model selectors and lifecycle controls before dispatch. Do not infer capability from a host or plugin name, installation alone, or the number of tools: one facade may expose both direct subagent and workflow operations.

| Available delegation capabilities | Execution choice |
| --- | --- |
| Direct subagents and workflows | Select direct coordination, a workflow phase or a hybrid by the phase's decision structure and concrete benefit. |
| Direct subagents only | Coordinate all phases through direct children, including bounded batches and dependent stages. Do not attempt a workflow call. |
| Workflows only | Use the available workflow for a bounded phase. For uncertain work, finish a short investigative phase, return its evidence to the parent and choose the next phase afterwards; do not guess a giant fixed pipeline. |
| Neither | Keep work that is eligible for parent execution in the parent. Report unavailable required delegation or independent acceptance; do not pretend to have run children. |

Choosing the available mode happens before dispatch, not by trying an unavailable API and falling back after failure. The executor must still preserve the selected Router role, exact model/provider/effort and required permissions. An explicit user requirement for an unavailable mode remains a limitation to report, not permission to substitute silently. Do not change installed plugins or host settings merely to make a preferred shape available.

## Choose for the current phase

When both modes are available, use the simplest supported shape that fits the next bounded phase. When only one is available, use it under the capability table above without changing scope or acceptance. Do not lock an entire project into one mode at the start. Honor an explicit user execution choice when the executor can support it without changing the required route, permissions or acceptance contract; otherwise report the limitation.

- **Direct coordination:** the parent launches bounded children, reads results and decides the next assignment. Independent children can run concurrently. Prefer this while discovery can change the scope, interfaces, dependencies or acceptance assumptions, when intermediate findings need the parent's judgment, or when a small named set of assignments does not benefit from a script.
- **Workflow phase:** a supported workflow executor coordinates a bounded phase with clear input/output contracts, dependencies, decision rules and stop conditions. When both modes are available, prefer this when repeated processing, per-item stages, reusable orchestration or structured aggregation pays for defining and checking the workflow. A discovered item list, variable item count, loops and known conditional branches are compatible with a workflow; they do not require direct coordination.
- **Hybrid:** the parent explores and settles boundaries directly, delegates a stable batch or subpipeline to a workflow, then resumes judgment and follow-ups from its returned evidence. Keep consequential direction and final acceptance in the parent.

More than one agent, parallel work, multiple steps, or coder-plus-verifier acceptance is NOT a workflow trigger. A short implementation/verification/repair sequence normally needs only direct coordination. Conversely, do not avoid a useful workflow merely because it contains several agents or a conditional decision.

When selecting between available modes, assess:

1. Can its inputs, outputs, ownership and dependent stages be specified now?
2. Can expected branches and failure/stop conditions be described without guessing unresolved requirements?
3. Is frequent parent/user intervention unlikely within this phase?
4. Does batching, pipeline overlap, reuse or aggregation offer a concrete advantage over direct calls?

These are judgment questions, not a numeric score or keyword classifier. When both modes are available and the shape is still uncertain, begin with direct coordination and reassess after evidence arrives. With workflows only, keep the next phase short and return its evidence to the parent before defining successors. Explain a non-obvious choice or mode change in one short sentence; do not narrate a planning ceremony before every call.

## Coordinate from evidence

Give each child a clear question or deliverable, ownership, necessary originals, acceptance criteria and stop conditions. Launch only the independent assignments needed now. As results arrive, check material evidence, resolve conflicts, and decide whether to continue a suitable owner, launch another role, stop, or move the next phase into a workflow. A failed child first needs diagnosis of infrastructure, missing context, implementation or scope; failure alone does not justify more agents or a workflow.

Keep just enough state in the parent's working context: current objective/phase, owners and IDs, dependencies, baseline/ref, outcomes and unresolved questions. Do not build a registry, task queue or persistent shared-memory protocol. Share source references and relevant facts rather than copying every sibling conversation; the research evidence contract still governs consequential conclusions.

Communication is parent-mediated under the available host tools. The parent can pass one child's evidence to another, send a supported mid-run correction, or continue an eligible finished owner. Do not claim automatic sibling context synchronization or a peer-to-peer messaging channel. Assigned children do not delegate further. A blocked child reports its question and stops; the parent resolves it before a suitable follow-up.

## Replan at a safe boundary

A workflow should finish its bounded phase and return useful outcomes, evidence references, failures and unresolved decisions. On an unexpected scope/interface/requirement change, stop dependent stages and hand the issue back instead of inventing the rest of the project inside a retry loop. Known, bounded branches can remain in the script, including a judgment child with a defined output contract.

Choose the next mode after the phase finishes, or after a supported stop is confirmed. A pause is not completion: in-flight children may still be working. Account for outstanding children and any partial diff before launching replacements. Recheck the baseline and preserve useful artifacts; mode changes are not context transfer and do not make old acceptance evidence current.

Use only the lifecycle controls the executor exposes. Unless the runtime explicitly makes workflow-owned children available to direct controls, do not send direct result/steer/resume calls to their IDs or promise to move their conversations outside the workflow. Start a properly briefed fresh child in an available mode for the next phase when necessary. Do not silently change execution mode to work around a provider, permission, extension or runner failure.

## Invariants in every mode

- The parent owns goal interpretation, consequential decisions, integration and final acceptance. No additional manager agent or recursive delegation is needed.
- Every completed coding work unit still needs an independent verify verdict on the actual diff and original criteria. Coder self-checks, test gates and workflow completion are not that verdict. Do not pass the coder's reasoning as acceptance evidence.
- Verification waits until writes to its targets stop. Preserve file/worktree ownership and applicable host isolation rules.
- Respect the aggregate Router maximum and stricter host limits across direct and workflow children, not one allowance per mode. Do not manufacture agents to fill capacity.
- Preserve exact roles, models, efforts/providers and permissions. Reuse only eligible owners; a route change needs a supported fresh launch.
- Keep the configured coding repair limit across mode changes; changing shape does not reset the same work unit's repairs or weaken its acceptance criteria.

## Examples and counterexamples

| Phase | Suitable choice | Reason |
| --- | --- | --- |
| Investigate intermittent login failures with two independent hypotheses | Direct coordination | Start both searches; the findings may change the root-cause investigation and fix boundary. |
| Check an SDK contract and a deployment setting, then decide compatibility | Direct coordination | Two named research assignments need synthesis, not an enclosing script. |
| Implement one bounded fix, independently verify it, send actionable findings to the coder | Direct coordination | Independent acceptance is required, but does not itself earn a workflow. |
| Discover route files, audit each under the same settled criteria, independently refute findings and aggregate outcomes | Workflow on a capable executor | The item count is unknown, but the per-item stages and output contract are stable. Preserve incomplete items rather than filtering them away. |
| Explore a migration, batch-check the settled targets, then decide which exceptions need fixes | Hybrid | Dynamic scope discovery surrounds a stable batch; exceptions return to the parent. |
| A batch audit reveals an undocumented shared authorization mechanism | Return to parent at a safe boundary | Stop dependent assumptions, inspect the relevant originals, settle the criteria and choose the next phase anew. |
| A provider rejects the requested model or a child cannot obtain required approval | Block the affected lane | Neither a workflow nor a mode change repairs infrastructure or grants permission. |

## Host mapping and sources

The decision policy depends on capabilities, not host/plugin brands. This repository's execution references describe its current integrations; their APIs are not universal. Another plugin's tools can follow this policy only when their actual schema and runtime preserve the selected Router routes, contracts, permissions and evidence requirements. Capability labels alone do not establish that compatibility.

The Codex reference describes native spawn, follow-up and lifecycle tools; the documentation term "subagent workflows" does not establish a scripted executor. The Pi reference describes lean run/result/steer, eligible resume and its scripted workflow API. Consult the applicable execution reference linked from SKILL.md, and the actual exposed schema, for context, isolation and lifecycle details. Do not transplant another executor's API or invent missing operations.

The design borrows composable patterns, not another runtime or its API:

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): simplest sufficient structure, orchestrator-workers, evaluator-optimizer and combining patterns. Its architectural term "workflow" is broader than Pi's scripted tool.
- [Anthropic: Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system): lead-agent delegation, evidence-driven follow-ups, bounded effort and coordination costs.
- [OpenAI: Codex subagents](https://developers.openai.com/codex/subagents): native parent coordination, parallel specialist work, follow-up instructions and lifecycle management. Available schemas vary by host/version; this policy does not change Router's V1 configuration.
- [OpenAI Agents SDK: Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/): manager-style agents as tools, code orchestration and mixing the two. This is SDK guidance, not a claim that Codex or Pi implements that SDK.
