# Pi execution

Task Router executes through `@ssk_dev/pi-subagents-lean` over tintinweb's engine. This reference describes its native API, not a new scheduler. Inspect `subagent({ op: "help", input: "workflow" })` when the installed schema is unclear.

## Native workflow

Use one enclosing call:

```js
subagent({
  op: "workflow",
  input: JSON.stringify({ script: "...", args: { /* JSON-shaped inputs */ } })
});
```

The script starts with a pure-literal `export const meta = { name, description }`. Top-level await and return are supported. It has no filesystem, shell, imports, network, eval, random numbers or clock. All real work happens in its children. It uses:

- `await agent(prompt, { agentType: "tr_...", model: "provider/exact-id", effort: "high", label: "unique-short-label" })` for a dependency;
- `await parallel([() => agent(...), () => agent(...)])` for independent work;
- `await pipeline(items, ...stages)` for per-item dependencies. Stages receive `(previousResult, originalItem, index)` and can overlap across items;
- `phase(title)`, `log(message)` and `args` for organization. Declare used phases in meta; use the `phase` option inside concurrent stages to avoid ambient-phase races.

Always select the named candidate and both route fields from [the role map](role-map.md). Native workflow effort accepts minimal/low/medium/high/xhigh/max, but NOT off in upstream 0.19.0. An off route is valid for direct runs only: report unsupported workflow routing instead of dropping effort, inheriting a level or silently changing execution protocol. A missing `agentType` defaults to general-purpose. No `runs.run`, `runs.all`, `async`, `context`, `output`, `cwd`, `baseRef`, `globalConcurrencyLimit` or top-level Dynamic Workflows options belong to this API.

`agent()` returns final text (or a validated object with `schema`), NOT a receipt with `.ok/.output`. A terminal failure or user skip returns `null`; throws inside parallel/pipeline may also become null. Check every required result and stop dependent stages on null. Do not filter failed acceptance checks out and report a partial batch as success. Return a JSON-safe aggregate explicitly. A successful string is still not a verifier verdict; capture actual checks and independent acceptance.

Workflows are always background. Do not add `run_in_background` to a workflow or `async` to its children. Keep all agent promises observed and awaited; the runtime rejects un-awaited children. Inspect native runs in `/agents → Workflows`; the facade's result/steer operations address direct agents, not workflow IDs.

## Concurrency and ownership

The engine caps each native workflow at `max(1, min(16, cpus - 2))`, independently of the session's `subagents.json maxConcurrent` pool. Router cannot set that cap through a tool argument. To enforce a smaller Router maximum, process bounded chunks and await each batch before launching the next. Bound pipeline item batches too: overlapping stages still count as live children. Never create multiple competing enclosing workflows or use nested delegation to bypass a cap.

Direct background agents also obey the engine's session maxConcurrent (default 10). Keep aggregate Router work under its own configured maximum and any stricter host limit. These pools are not Codex's session-wide thread limit.

Keep one writer per shared cwd/worktree. Readers of changing content depend on the writer. Independent concurrent writers need managed worktrees with distinct ownership.

`isolation: "worktree"` starts from committed HEAD; it cannot see staged/uncommitted changes and has no baseRef parameter. Never use it to review an uncommitted diff. Check `worktreeIsolation` is enabled in both effective global/project settings BEFORE requesting isolation: the engine can silently drop the option when disabled. A creation failure is a blocker, not permission to run unisolated.

The engine preserves changed work as a local `pi-agent-*` branch, then removes the temporary worktree. Consume the returned branch/handoff, not a stale directory path. The parent owns integration and affected acceptance. Bash is not confined to the copy by an OS sandbox.

## Continuity

Direct runs notify completion and return an agent ID. Inspect once when needed with `subagent({ op: "result", agent_id })`; use `input: "{\"verbose\":true}"` for the conversation. A live direct agent receives `op: "steer", agent_id, message`. A finished eligible agent resumes via `op: "run", prompt, description, subagent_type` plus `input: "{\"resume\":\"<id>\"}"`. Check the result schema via help when needed.

A live record retains its session/model/tools on resume. Disk-reopened mentions re-resolve the current agent definition; do not assume a historical tool contract after reload, edits or record eviction. If the owner cannot resume safely, report why and start a fresh same-role child with a sufficient brief. Never imply restored history when none exists. A route change needs a new named launch.

Inside a workflow, label the original child and continue it with `await agent("focused follow-up", { resume: "original-label" })`. Do NOT combine resume with agentType/model/effort/isolation/gate/schema. Resume-by-label and journal replay are different:

- `resume` continues a child's conversation;
- `resumeFromRunId` replays an unchanged leading prefix of prior workflow calls, only within the same session, after that workflow has finished/stopped. Failed/changed calls break the prefix. A workflow containing child resume cannot be journal-replayed.

Workflow children are owned by their workflow and invisible to direct result/steer tools. Use the native inspector to stop/pause/retry a live workflow; do not invent workflow_control or runs.steer endpoints for this runtime.

## Evidence and failures

While a child writes, the parent may inspect unaffected material, but must not edit that checkout. Background runs deliver native notifications. When only pending children remain, yield: never sleep, poll or use another engine merely to wait.

There is no supervisor RPC or contact_supervisor tool. A child reports blockers/questions and stops; the parent resolves and resumes when eligible. A steering delivery is not proof of compliance.

Use `gate` for an actual shell validation when appropriate; on Windows it runs through cmd, not bash. With a worktree it runs before cleanup, in the child's tree. A gate supplements, never replaces, independent `tr_verify` acceptance. Read-only children return reports as text; the engine writes their transcripts/journal, so do not add write permission for artifacts. Preserve desired reports outside temporary storage before reboot.

Check actual resolved model/thinking in child session/invocation metadata or the workflow inspector (including "asked" versus effective levels), not merely requested options or child prose. Null outputs, incomplete/steered runs, route mismatch, clamping, missing web_access, leaked tools and setup failures are not acceptance passes.

On failure record exact route/error/run, cwd/worktree/branch/ref and any partial diff; retry only the affected lane after checking baseline. Never silently replace a model, builtin role, workflow engine, permissions or execution mode.
