# Parallel work

Actively run independent work at the same time through the host's native spawn capability: separate searches for separate questions, separate non-code deliverables, and separate development units. Several children of the same role are fine. Reuse the owner for near-term continued work on the same module; do not serialize unrelated modules just to reuse an agent.

The parent mediates evidence and follow-up instructions between children through supported native tools. Do not claim peer-to-peer messaging or synchronized sibling context. Choose the current phase's shape under [phase-level orchestration](orchestration.md); several children or independent verification do not require a separate workflow executor. Reassess after discoveries rather than fixing an entire project plan up front.

## Continuity and context

Apply the Skill's dispatch and context freshness checks before reusing an owner. For related implementation, repairs, or focused research follow-ups, use `send_input` with the known ID and send only new requirements, changed facts or baseline, and necessary sources. Do not replay the full history.

Use `resume_agent` for a closed agent only when the actual host supports it and can restore that agent's context. If restoration is unavailable or fails, create a new agent with a concise, sufficient brief and state that it starts in a new context. Do not promise permanent recovery across parent sessions or restarts. Prompts and resume cannot force a change of model, role, or permissions; if a different candidate is needed and the host cannot switch it, create the correct candidate.

Check the exposed tool schema on each dispatch. Use only the named-role, context, and isolation options it actually provides; do not invent parameters. Independent new tasks start fresh with a sufficient brief (for example `fork_context=false` when supported). Fork only when most of the parent's history is relevant and the host can preserve the selected role, model/effort, provider, and permissions. Neither fresh nor forked context is mandatory for every dispatch.

The current `fork_context=true` copies the current parent conversation snapshot. It does not share an arbitrary sibling agent's complete context or keep contexts synchronized. Share concise neutral project facts and necessary original sources instead; the Skill's brief and research evidence rules still apply.

## Isolation and lifecycle

Codex app worktrees (https://developers.openai.com/codex/app/worktrees) are separate chats on a Git repository, start on a detached HEAD by default, and return through Handoff into Local. Use the isolation the host actually exposes, or existing `git worktree` commands directly, when they fit the work; do not build a scheduler, worktree manager, task queue, or task-file format.

Write rules follow the checkout:

- One shared checkout: one writer per file or overlapping write scope at a time. A unit that reads content another unit is still writing depends on that unit; read-only status alone is not independence.
- Separate worktrees: each writer works on its own copy in parallel, and the parent integrates the results.

The parent owns the split, dependency order, integration, and verification. Read a dependency's result before dispatching its successors. Each code unit receives its own independent verify verdict under the coding verification contract, which may run in parallel inside its worktree; after integration the parent checks the affected behavior instead of rerunning every check.

Keep the total concurrent children within the configured session-wide maximum (30 in this profile); do not create agents merely to reach that limit. Retain an owner temporarily only for a clear near-term follow-up. Close it when the work line is complete, no such follow-up remains, or a slot must be released. Do not close after every small task or keep agents resident indefinitely.
