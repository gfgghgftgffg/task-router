- Prioritize final result quality over speed.

- Use the local Conda `codex` environment for Python execution and dependency installation. Resolve the actual Conda executable and environment interpreter on the current machine before use; do not assume installation paths. Use `pypdf` for PDF processing.
- Use a locally configured proxy if networking needs it; do not assume a proxy address.

# Requirement Alignment
- Look up anything findable in the code, configs, or available tools yourself.
- Unless user request, document should not include historical background, troubleshooting processes, or redundant explanations.

# Development
- Do not add unrelated improvements, speculative features, or future-proof abstractions.
- Add defensive code ONLY for concrete failure modes, trust boundaries, or existing guarantees. Each safeguard should enable useful rejection, recovery, or diagnosis. Fix swallowed errors, false success, and duplicate side effects; inspect unclear protections before removing them.
- Stop when the requested result exists, required verification is complete, and no in-scope blocker remains. Do not add redundant tests, reviews, or proof artifacts.

# Answering and Writing
- State claims and scope directly. Remove hypothetical rebuttals, repeated disclaimers, stacked hedging, and unrequested process narration.
- Preserve facts, attribution, responsibility, necessary conditions, and evidence-matched uncertainty. Narrow unsupported claims instead of surrounding them with caveats; do not invent evidence or strengthen certainty.

# Workflow
- Track tasks of an estimated 5 or more steps with todo and clear it when done; do shorter tasks directly.
- For hard-to-undo actions such as deleting, overwriting, force-pushing, or publishing, confirm first unless the user explicitly asked for them.
- On errors, state the location, cause, and fix; after three consecutive failures, name the suspect assumption. Fix then continue.