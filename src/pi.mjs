import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, ROLE_META, getRoleChoices, mergeAgents, planInstall, safeTarget } from './router.mjs';

export const PI_THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const PI_MARKERS = { start: '<!-- pi-task-router:start -->', end: '<!-- pi-task-router:end -->' };
export const PI_MANIFEST = '.task-router/pi/manifest.json';
export const PI_RUNTIME = '@ssk_dev/pi-subagents-lean';
const roles = Object.keys(ROLE_META).join('|');
// The flat namespace is required by tintinweb's non-recursive discovery. Old
// nicobailon base/candidate paths are removable only with an unchanged manifest hash.
const PI_STALE_PATH = new RegExp(`^(?:agents/task-routing/(?:${roles})(?:_[a-z][a-z0-9_-]*)?\\.md|agents/tr_(?:${roles})_[a-z][a-z0-9_-]*\\.md)$`);
const read = filename => fs.readFileSync(filename, 'utf8');
const json = filename => JSON.parse(read(filename).replace(/^\uFEFF/, ''));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const tableText = value => String(value).replace(/\|/g, '\\|');

// Any ext: selector closes extension-tool exposure to an explicit allowlist.
// Select the mandatory executor's facade and deny it: other extension hooks
// (including permission hooks) still load, but no unlisted extension tool leaks.
const executorSelector = 'ext:pi-subagents-lean/subagent';
export const PI_DENIED_TOOLS = ['subagent', 'Agent', 'SubagentWorkflow', 'workflow', 'workflow_control', 'get_subagent_result', 'steer_subagent'];
export const PI_ROLE_TOOLS = {
  coding: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', executorSelector],
  search: ['read', 'grep', 'find', 'ls', executorSelector, 'ext:pi-web-access-lean/web_access'],
  verify: ['read', 'grep', 'find', 'ls', 'bash', executorSelector],
  reasoning: ['read', 'grep', 'find', 'ls', executorSelector],
  general: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', executorSelector],
};

export const defaultPiHome = () => process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
export const piModel = settings => settings.provider ? `${settings.provider}/${settings.model}` : settings.model;

export function validatePiConfig(c) {
  for (const choice of [{ role: 'orchestrator', ...c.orchestrator }, ...getRoleChoices(c)]) {
    assert(PI_THINKING.includes(choice.effort), `${choice.role}${choice.id && choice.id !== 'default' ? `:${choice.id}` : ''}: Pi does not support effort '${choice.effort}'; use ${PI_THINKING.join(', ')}`);
  }
}

function readObject(target, label) {
  if (!fs.existsSync(target)) return { content: undefined, settings: {} };
  const content = read(target);
  let settings;
  try { settings = JSON.parse(content.replace(/^\uFEFF/, '')); }
  catch { throw new Error(`Cannot parse ${label}: ${target}`); }
  assert(settings && typeof settings === 'object' && !Array.isArray(settings), `${label} must be an object: ${target}`);
  return { content, settings };
}

export function readPiSettings(home) {
  const target = safeTarget(home, 'settings.json');
  const { content, settings } = readObject(target, 'Pi settings');
  if (settings.defaultProvider !== undefined) {
    assert(typeof settings.defaultProvider === 'string' && settings.defaultProvider.trim() !== '', `Pi defaultProvider must be a non-empty string: ${target}`);
  }
  return { target, content, text: '', settings };
}

export function readPiRuntimeSettings(home, cwd = process.cwd()) {
  const targets = [...new Set([safeTarget(home, 'subagents.json'), safeTarget(cwd, '.pi/subagents.json')])];
  let settings = {};
  const guards = [];
  for (const target of targets) {
    const value = readObject(target, 'Pi subagents settings');
    settings = { ...settings, ...value.settings };
    guards.push({ target, old: value.content, label: 'Pi subagents settings' });
  }
  return { settings, guards };
}

export function renderPi(c) {
  validatePiConfig(c);
  const files = new Map(), choices = getRoleChoices(c), rows = [];
  for (const [role, meta] of Object.entries(ROLE_META)) {
    const contract = read(path.join(ROOT, 'roles', `${role}.md`));
    for (const choice of choices.filter(item => item.role === role)) {
      // Deliberately omit model/thinking: direct Agent calls cannot override
      // frontmatter pins. The role map supplies both on EVERY fresh dispatch,
      // preserving active-provider inheritance and task-scoped user overrides.
      files.set(`agents/${choice.nativeRole}.md`, [
        '---',
        `name: ${choice.nativeRole}`,
        `description: ${JSON.stringify(meta.description)}`,
        `tools: ${PI_ROLE_TOOLS[role].join(', ')}`,
        `disallowed_tools: ${PI_DENIED_TOOLS.join(', ')}`,
        'extensions: true',
        'skills: false',
        'allowed_subagents: none',
        'prompt_mode: replace',
        'inherit_context: false',
        'run_in_background: true',
        '---', '', contract,
      ].join('\n'));
      rows.push(`| ${role}${choice.id === 'default' ? '' : ` (${choice.id})`} | ${choice.nativeRole} | ${tableText(choice.model)} | ${choice.effort} | ${choice.provider || 'active parent provider'} | ${choice.when ? tableText(choice.when) : '-'} | [contract](roles/${role}.md) |`);
    }
    files.set(`skills/task-routing/references/roles/${role}.md`, contract);
  }
  files.set('skills/task-routing/SKILL.md', read(path.join(ROOT, 'skill', 'pi', 'SKILL.md')));
  files.set('skills/task-routing/references/pi-execution.md', read(path.join(ROOT, 'skill', 'pi', 'execution.md')));
  for (const filename of ['coding-quality.md', 'research-evidence.md', 'orchestration.md']) {
    files.set(`skills/task-routing/references/${filename}`, read(path.join(ROOT, 'skill', 'references', filename)));
  }
  files.set('skills/task-routing/references/role-map.md', [
    '# Configured Pi routes', '',
    `Generated from routing.toml; source profile label: ${c.profile}. Runtime: ${PI_RUNTIME} over @tintinweb/pi-subagents. These are Router agents, not builtin personas.`, '',
    `Parent startup choice: model ${piModel(c.orchestrator)}; thinking ${c.orchestrator.effort}. Loading this skill does not switch the parent model.`,
    `Maximum concurrent children requested by Router: ${c.max_concurrent}. Maximum coding repair follow-ups per work unit: ${c.max_coding_repairs}.`,
    'Respect stricter host limits. The native workflow cap is max(1, min(16, cpus - 2)), not a configurable globalConcurrencyLimit. Bound each parallel batch to the Router maximum; direct background runs also obey subagents.json maxConcurrent.', '',
    '| Work | Agent | Model ID | Thinking | Provider | When | Instructions |',
    '| --- | --- | --- | --- | --- | --- | --- |', ...rows, '',
    'Each candidate is a named tr_* agent with the original role contract. Choose by complexity, risk, context volume, and economy; do not use the strongest candidate for every task.',
    'Model/thinking are intentionally NOT pinned in agent frontmatter. Always supply both from this table (or the explicit user override); a bare named launch would inherit the parent model and is NOT Router routing.',
    'An omitted provider inherits the active parent provider, not the provider on another candidate or the recommended orchestrator. Check the exact available registry entry and supported thinking before launching. Never rely on fuzzy/provider fallback or clamping.',
    'Direct lean dispatch uses op: run, subagent_type and prompt, with model: provider/id and thinking as separate fields in input JSON. Native workflow agent() uses agentType, model and effort. Never append :thinking to the model.',
    'Choose the current phase\'s execution shape separately from model tier under [phase-level orchestration](orchestration.md). Check actual delegation capabilities, not host/plugin names: with both direct subagents and workflows choose by decision structure; with one use it for bounded phases; with neither report required delegation as unavailable. Preserve routes, acceptance, aggregate concurrency and repair limits.',
    'Explicit user model/effort choices override only their stated task or role scope without rewriting configuration. Prefer a matching candidate; an ad-hoc override retains the original tools and contract. Refuse unsupported choices.',
    'Continue related work only after checking its stored route, current definition, cwd and baseline. A changed route needs a new fresh child. Coder/verifier contexts are independent.',
    'Search exposes the lean web_access facade (search/check/fetch/get), not four raw web tools. Search/reasoning have no bash/edit/write. Verify has bash but no edit/write; no-source-edit is policy, not an OS sandbox.',
    'Check global and project .pi/agents / .agents/agents definitions before dispatch: frontmatter pins can outrank a direct-call override. Replaced prompts do not inherit AGENTS.md; include applicable constraints in each cold-start brief.', '',
  ].join('\n'));
  files.set('AGENTS.md', [
    PI_MARKERS.start,
    'Task Router for Pi is opt-in. When the user invokes /skill:task-routing or applicable instructions explicitly enable it, the coordinating parent follows that skill and its generated tr_* role map. Otherwise keep the existing workflow.',
    'Installation alone does not authorize delegation. An assigned child follows its role contract and does not activate parent routing or launch further agents.',
    'Use @ssk_dev/pi-subagents-lean for execution, not builtin role substitutions or a separate runner. Supply exact model and thinking from the role map on every fresh launch; explicit task-scoped choices take precedence. Preserve host permissions and report unsupported routes.',
    'Choose among available direct-subagent and workflow operations by decision structure and useful batching, not agent count or number of steps. If only one is available, use it for bounded phases; do not invent the other. Reassess at safe phase boundaries; independent coding acceptance remains required.',
    PI_MARKERS.end, '',
  ].join('\n'));
  return files;
}

export function planPiInstall(files, home, options = {}) {
  const base = options.base ?? readPiSettings(home);
  const runtime = readPiRuntimeSettings(home, options.cwd);
  const changes = planInstall(files, home, {
    base, manifestPath: PI_MANIFEST, stalePattern: PI_STALE_PATH,
    mergeAgents: (existing, block) => mergeAgents(existing, block, PI_MARKERS),
  });
  changes.guards.push(...runtime.guards);
  return changes;
}

// Optional credential-free evidence, not a live-model probe. No extension loads,
// authentication reads, network requests or model calls happen in this CLI.
export function inspectPiCatalog(c, home, catalogOverride, options = {}) {
  validatePiConfig(c);
  const { settings } = readPiSettings(home);
  const { settings: runtime } = readPiRuntimeSettings(home, options.cwd);
  const errors = [], warnings = [], rows = [];
  let models, activeProvider;
  const catalogPath = catalogOverride ? path.resolve(catalogOverride) : undefined;
  if (catalogPath) {
    let catalog;
    try { catalog = json(catalogPath); }
    catch { throw new Error(`Cannot read Pi registry snapshot: ${catalogPath}`); }
    assert(Array.isArray(catalog?.models), 'Pi registry snapshot must contain a models array');
    activeProvider = catalog.activeProvider;
    if (activeProvider !== undefined) assert(typeof activeProvider === 'string' && /^[a-zA-Z0-9_-]+$/.test(activeProvider), 'Pi registry snapshot activeProvider must be a valid provider ID');
    const seen = new Set();
    models = catalog.models;
    for (const model of models) {
      assert(model && typeof model.provider === 'string' && /^[a-zA-Z0-9_-]+$/.test(model.provider)
        && typeof model.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/.test(model.id), 'Pi registry snapshot entries require valid provider and id strings');
      const key = `${model.provider}/${model.id}`;
      assert(!seen.has(key), `Pi registry snapshot has duplicate model '${key}'`);
      seen.add(key);
      if (model.thinkingLevels !== undefined) assert(Array.isArray(model.thinkingLevels) && model.thinkingLevels.every(level => PI_THINKING.includes(level)), `Pi registry snapshot '${key}': invalid thinkingLevels`);
    }
  } else warnings.push('No Pi registry snapshot supplied. Model availability, provider resolution and model-specific thinking support are unverified; inspect the live Pi registry before dispatch.');
  for (const choice of [{ role: 'orchestrator', id: 'default', nativeRole: 'orchestrator', ...c.orchestrator }, ...getRoleChoices(c)]) {
    const label = choice.id === 'default' ? choice.role : `${choice.role}:${choice.id}`;
    // An observed parent provider outranks a recommended startup provider for
    // children. An explicitly configured candidate provider always wins.
    const provider = choice.provider ?? (choice.role === 'orchestrator' ? undefined : activeProvider) ?? c.orchestrator.provider ?? settings.defaultProvider;
    let model;
    if (models) {
      const matches = models.filter(item => item.id === choice.model && (!provider || item.provider === provider));
      if (!matches.length) errors.push(`${label}: '${provider ? `${provider}/` : ''}${choice.model}' is absent from the Pi registry snapshot`);
      else if (matches.length > 1) errors.push(`${label}: model '${choice.model}' has multiple providers; set provider or snapshot activeProvider explicitly`);
      else model = matches[0];
      if (model?.thinkingLevels) {
        if (!model.thinkingLevels.includes(choice.effort)) errors.push(`${label}: thinking '${choice.effort}' is unsupported; advertised: ${model.thinkingLevels.join(', ') || '(none)'}. Refusing a route that Pi would clamp.`);
      } else if (model) warnings.push(`${label}: snapshot does not advertise thinkingLevels; thinking support is unverified`);
    }
    if (choice.role !== 'orchestrator' && choice.effort === 'off') warnings.push(`${label}: thinking off is supported by direct lean runs, but native workflow agent() effort rejects off; do not silently inherit another level.`);
    rows.push({ role: label, agent: choice.nativeRole, model: choice.model, thinking: choice.effort, provider: model?.provider ?? provider ?? 'active parent provider' });
  }
  if (runtime.workflowsEnabled === false) warnings.push('Pi subagents.json workflowsEnabled is false; native lean workflow routing is unavailable, but direct coordination remains available. Report unsupported explicit workflow requests.');
  if (runtime.fallbackSubagent !== 'none' && runtime.fallbackSubagent !== false) warnings.push('Set fallbackSubagent: "none" in subagents.json to reject unknown/disabled agents instead of substituting a builtin role.');
  if (runtime.strictAgentFiles !== true) warnings.push('Set strictAgentFiles: true in subagents.json to refuse malformed agent files at startup; still inspect mid-session changes.');
  if (runtime.worktreeIsolation === false) warnings.push('Pi subagents.json worktreeIsolation is false: the engine can silently drop requested isolation. Do not launch concurrent writers or claim a worktree.');
  if (settings.subagents) warnings.push('Legacy settings.json subagents options belong to nicobailon; lean uses subagents.json instead. Legacy maxThinking/agentOverrides do not enforce routes.');
  warnings.push('Static checks do not prove lean loading, credentials, project agent overrides, extension tool scope or dispatch success. Inspect /agents and subagent help, then verify the actual child model/thinking and tools.');
  warnings.push('Pi tool allowlists do not reproduce Codex OS sandboxes. Verification bash can write files; no-source-edit is a role contract.');
  return { errors, warnings, rows, catalogPath };
}
