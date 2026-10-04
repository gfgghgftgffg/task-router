# Pi execution

Task Router delegates through the installed pi-subagents runtime. Read its installed `workflows` and `tool-reference` guides before composing a workflow; this file is routing guidance, not another scheduler or runner.

## Workflow shape

Use one enclosing `subagent` call with `workflow: true`, `async: true` and the configured `globalConcurrencyLimit` for multi-step or parallel work. Write one `js workflow` block in the same reply. Its script uses `await runs.run(key, { label, agent, model, task, ... })` for dependencies and `await runs.all([{ key, label, agent, model, task, ... }])` for independent children. Choose actual agents and exact models from [the role map](role-map.md) and runtime discovery; do not copy example IDs as if they were registered.

Keep stable machine keys separate from short verb + behavior labels. `runs.all` returns an ordered array, not a map. Await each child before reading `.output` or `.structuredOutput`; check `.ok` and errors rather than accepting prose as success. Use an explicit `return` for the aggregate result.

Omit child `async` inside awaited workflow steps: they retain completed-result semantics and the runtime starts them in the background. Explicit child `async: true` returns a launch receipt, not a final result. Top-level workflow `async: true` is separate. Ordinary direct child launches also use `async: true`.

Use top-level await or plain helper functions. Do not define nested async functions/arrows/methods. The script has no filesystem, shell or arbitrary Pi tools; raw scripts cannot call `runs.host`. Do not invent legacy top-level `tasks`, `chain` or `parallel` inputs. If workflow scripts are disabled, report the unsupported route instead of silently changing the configured protocol.

Independent work may run concurrently. Keep the aggregate active children under the configured Router maximum and any stricter host ceiling. `globalConcurrencyLimit` caps children within one workflow, not the whole Pi session. Do not create agents merely to reach the limit or launch multiple competing coordinators.

## Ownership and isolation

Keep one writer per shared cwd/worktree. A reader of content another child is changing depends on that writer. Independent concurrent writers need separate managed worktrees and distinct ownership.

Use pi-subagents `worktree: true` only when isolation is needed and the source is clean. `baseRef` supports `HEAD` or a named ref, not a full commit hash or a revision expression. Consume the returned patch/handoff and artifact references; do not drop isolation or run manual destructive cleanup after a setup failure. The parent owns integration and affected acceptance checks.

Bind durable child reports with `output` on `runs.run`/`runs.all`, not just a filename in task prose. Prefer managed relative outputs; return the actual `outputReference`, `outputPathMapping` or `artifactPaths`. Read-only children can return text for the runtime to persist without gaining write tools.

## Context and continuity

Independent tasks start fresh with sufficient briefs. Fork is a parent snapshot, not live sharing of sibling histories. Keep implementation and verification independent.

For a known child, inspect `subagent({ action: "status", id: "..." })`. A live child receives focused guidance with `action: "steer"`; a completed/paused child may be continued with `action: "resume", id, message`. Resume authoritatively checks eligibility and preserves the stored agent, model and tools. If unavailable, say why and start a new same-role context with a sufficient brief; do not imply its history was restored.

Inside a workflow, use `await runs.run(newKey, { resume: priorRunId, task: "focused follow-up" })` without `agent` or `model`. Each distinct follow-up needs a new stable key. Retain the latest returned `runId` for later continuations. `children.list` is a workflow-only roster, not an exhaustive list of direct children. To change a route, launch the new candidate rather than trying to change it through resume.

Steer a workflow child through `await runs.steer(key, message)` using its stable key, not a raw run ID. Delivery receipts do not prove model compliance. Observe every stored run promise with await, Promise.race or Promise.all before workflow completion.

## Async results and failures

While an async child writes, the parent may inspect unaffected material or prepare validation, but must not edit the same active checkout. Answer blocking child requests through `subagent_supervisor` using the exact `replyTo`; children use `contact_supervisor` when available.

Ordinary async runs notify the parent natively. When only pending children remain, yield and let Pi wake the session; do not sleep, poll or call `bg_wait` merely to wait. Use `bg_wait` only for provider/detached work without native completion delivery when the result is required at that barrier. Keep final verification async too; foreground mode is not a workaround for a last gate.

Execution success, validation evidence and the Router verifier's verdict are distinct. Generated roles do not request Pi's automatic builtin-reviewer inference; the parent still arranges independent `tr_verify` acceptance under [the coding contract](coding-quality.md). Preserve host-configured evidence gates instead of disabling them to obtain a pass.

On workflow/child/provider/extension/tool setup failure, stop the affected lane and record the exact failure, run/status and repo/cwd/worktree/branch/ref. Verify a clean worktree or capture the partial diff before a same-protocol retry. Do not silently replace the model, use Pi builtin roles, switch to a different workflow engine, run `pi -ne`, or fall back to Codex/Claude/Cursor CLI.
