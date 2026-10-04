import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, ROLE_META, getRoleChoices, mergeAgents, planInstall, safeTarget } from './router.mjs';

export const PI_THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const PI_MARKERS = { start: '<!-- pi-task-router:start -->', end: '<!-- pi-task-router:end -->' };
export const PI_MANIFEST = '.task-router/pi/manifest.json';
const PI_CANDIDATE_PATH = new RegExp(`^agents/task-routing/(?:${Object.keys(ROLE_META).join('|')})_[a-z][a-z0-9_-]*\\.md$`);
const read = filename => fs.readFileSync(filename, 'utf8');
const json = filename => JSON.parse(read(filename).replace(/^\uFEFF/, ''));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const tableText = value => String(value).replace(/\|/g, '\\|');

// Tool allowlists are not an OS sandbox. Search/reasoning deliberately omit bash;
// verification retains bash to run checks, with its no-source-edit boundary in the contract.
export const PI_ROLE_TOOLS = {
  coding: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', 'contact_supervisor'],
  search: ['read', 'grep', 'find', 'ls', 'web_search', 'fetch_content', 'get_search_content', 'source_check', 'contact_supervisor'],
  verify: ['read', 'grep', 'find', 'ls', 'bash', 'contact_supervisor'],
  reasoning: ['read', 'grep', 'find', 'ls', 'contact_supervisor'],
  general: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', 'contact_supervisor'],
};

export const defaultPiHome = () => process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
export const piModel = settings => settings.provider ? `${settings.provider}/${settings.model}` : settings.model;

export function validatePiConfig(c) {
  for (const choice of [{ role: 'orchestrator', ...c.orchestrator }, ...getRoleChoices(c)]) {
    assert(PI_THINKING.includes(choice.effort), `${choice.role}${choice.id && choice.id !== 'default' ? `:${choice.id}` : ''}: Pi does not support effort '${choice.effort}'; use ${PI_THINKING.join(', ')}`);
  }
}

export function readPiSettings(home) {
  const target = safeTarget(home, 'settings.json');
  const content = fs.existsSync(target) ? read(target) : undefined;
  let settings = {};
  if (content !== undefined) {
    try { settings = JSON.parse(content.replace(/^\uFEFF/, '')); }
    catch { throw new Error(`Cannot parse Pi settings: ${target}`); }
    assert(settings && typeof settings === 'object' && !Array.isArray(settings), `Pi settings must be an object: ${target}`);
    if (settings.defaultProvider !== undefined) {
      assert(typeof settings.defaultProvider === 'string' && settings.defaultProvider.trim() !== '', `Pi defaultProvider must be a non-empty string: ${target}`);
    }
  }
  return { target, content, text: '', settings };
}

export function renderPi(c) {
  validatePiConfig(c);
  const files = new Map();
  const choices = getRoleChoices(c);
  const rows = [];
  for (const [role, meta] of Object.entries(ROLE_META)) {
    const contract = read(path.join(ROOT, 'roles', `${role}.md`));
    for (const choice of choices.filter(item => item.role === role)) {
      const filename = `agents/task-routing/${choice.id === 'default' ? role : `${role}_${choice.id}`}.md`;
      // Do not declare acceptanceRole: writer: its inferred review defaults refer
      // to Pi's builtin reviewer. Router keeps independent tr_verify orchestration.
      files.set(filename, [
        '---',
        `name: ${choice.nativeRole}`,
        `description: ${JSON.stringify(meta.description)}`,
        `model: ${JSON.stringify(piModel(choice))}`,
        `thinking: ${choice.effort}`,
        `tools: ${PI_ROLE_TOOLS[role].join(', ')}`,
        'systemPromptMode: replace',
        'inheritProjectContext: true',
        'inheritGlobalContext: true',
        'inheritSkills: false',
        'defaultContext: fresh',
        'async: true',
        '---', '', contract,
      ].join('\n'));
      rows.push(`| ${role}${choice.id === 'default' ? '' : ` (${choice.id})`} | ${choice.nativeRole} | ${tableText(choice.model)} | ${choice.effort} | ${choice.provider || 'active parent provider'} | ${choice.when ? tableText(choice.when) : '-'} | [contract](roles/${role}.md) |`);
    }
    files.set(`skills/task-routing/references/roles/${role}.md`, contract);
  }
  files.set('skills/task-routing/SKILL.md', read(path.join(ROOT, 'skill', 'pi', 'SKILL.md')));
  files.set('skills/task-routing/references/pi-execution.md', read(path.join(ROOT, 'skill', 'pi', 'execution.md')));
  for (const filename of ['coding-quality.md', 'research-evidence.md']) {
    files.set(`skills/task-routing/references/${filename}`, read(path.join(ROOT, 'skill', 'references', filename)));
  }
  files.set('skills/task-routing/references/role-map.md', [
    '# Configured Pi routes', '',
    `Generated from routing.toml; source profile label: ${c.profile}. All agents below belong to Task Router, not Pi builtin roles.`, '',
    `Parent startup choice: model ${piModel(c.orchestrator)}; thinking ${c.orchestrator.effort}. Loading this skill does not switch the parent model.`,
    `Maximum concurrent children requested by Router: ${c.max_concurrent}. Maximum coding repair follow-ups per work unit: ${c.max_coding_repairs}.`,
    'Respect stricter host limits. Set globalConcurrencyLimit on the one enclosing pi-subagents workflow when composing concurrent work; Router does not install a session-wide scheduler.', '',
    '| Work | Agent | Model ID | Thinking | Provider | When | Instructions |',
    '| --- | --- | --- | --- | --- | --- | --- |', ...rows, '',
    'Each candidate is a named tr_* agent with the original role contract. Choose by task complexity, risk, context volume, and economy; do not use the strongest candidate for every task.',
    'An omitted provider inherits the active parent provider, not the provider on another candidate. Resolve every route against action: models and send the exact provider/id:thinking on a fresh dispatch; do not rely on fuzzy model selection or settings overrides.',
    'Explicit user model/effort choices override only their stated task or role scope, without rewriting configuration. Prefer a matching named candidate. An ad-hoc override must retain the selected role and tools, use a registered exact model, and support the requested thinking level. Report unsupported choices instead of substituting.',
    'Use the same candidate when resuming related work; a resume retains its stored model and tool contract. Select a new named candidate with a fresh brief when the required route changes.',
    'Search and reasoning have no bash/edit/write tools. Search requires pi-web-access in its background child. Verify has bash for checks but no edit/write tools: its no-source-edit boundary is policy, not a filesystem sandbox.',
    'At dispatch, compare loaded capabilities with the installed contract, since project agents and user/project overrides can shadow these defaults. Reject an unexpected runner, tools, or model route rather than weakening permissions.', '',
  ].join('\n'));
  files.set('AGENTS.md', [
    PI_MARKERS.start,
    'Task Router for Pi is opt-in. When the user invokes /skill:task-routing or applicable instructions explicitly enable it, the coordinating parent follows that skill and its generated tr_* role map. Otherwise keep the existing workflow.',
    'Installation alone does not authorize delegation. An assigned child follows its role contract and does not activate parent routing or launch further agents.',
    'Use pi-subagents for execution, not builtin role substitutions or a separate runner. Explicit task-scoped model/thinking choices take precedence; preserve host permissions and report unsupported routes.',
    PI_MARKERS.end, '',
  ].join('\n'));
  return files;
}

export function planPiInstall(files, home, options = {}) {
  const base = options.base ?? readPiSettings(home);
  return planInstall(files, home, {
    base,
    manifestPath: PI_MANIFEST,
    stalePattern: PI_CANDIDATE_PATH,
    mergeAgents: (existing, block) => mergeAgents(existing, block, PI_MARKERS),
  });
}

// An optional credential-free snapshot of Pi's live registry makes CLI doctor
// deterministic. It never tries to discover models by loading extensions or calling APIs.
export function inspectPiCatalog(c, home, catalogOverride) {
  validatePiConfig(c);
  const { settings } = readPiSettings(home);
  const errors = [], warnings = [], rows = [];
  const ceiling = settings.subagents?.maxThinking;
  if (ceiling !== undefined) assert(PI_THINKING.includes(ceiling), 'Pi subagents.maxThinking must be a supported thinking level');
  let models;
  const catalogPath = catalogOverride ? path.resolve(catalogOverride) : undefined;
  if (catalogPath) {
    let catalog;
    try { catalog = json(catalogPath); }
    catch { throw new Error(`Cannot read Pi registry snapshot: ${catalogPath}`); }
    assert(Array.isArray(catalog?.models), 'Pi registry snapshot must contain a models array');
    const seen = new Set();
    models = catalog.models;
    for (const model of models) {
      assert(model && typeof model.provider === 'string' && /^[a-zA-Z0-9_-]+$/.test(model.provider)
        && typeof model.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/.test(model.id), 'Pi registry snapshot entries require valid provider and id strings');
      const key = `${model.provider}/${model.id}`;
      assert(!seen.has(key), `Pi registry snapshot has duplicate model '${key}'`);
      seen.add(key);
      if (model.thinkingLevels !== undefined) {
        assert(Array.isArray(model.thinkingLevels) && model.thinkingLevels.every(level => PI_THINKING.includes(level)), `Pi registry snapshot '${key}': invalid thinkingLevels`);
      }
    }
  } else warnings.push('No Pi registry snapshot supplied. Model availability, provider resolution and model-specific thinking support are unverified; inspect action: models in Pi.');
  for (const choice of [{ role: 'orchestrator', id: 'default', nativeRole: 'orchestrator', ...c.orchestrator }, ...getRoleChoices(c)]) {
    const label = choice.id === 'default' ? choice.role : `${choice.role}:${choice.id}`;
    if (choice.role !== 'orchestrator' && ceiling !== undefined && PI_THINKING.indexOf(choice.effort) > PI_THINKING.indexOf(ceiling)) {
      errors.push(`${label}: thinking '${choice.effort}' exceeds Pi subagents.maxThinking '${ceiling}'`);
    }
    const provider = choice.provider ?? c.orchestrator.provider ?? settings.defaultProvider;
    let model;
    if (models) {
      const matches = models.filter(item => item.id === choice.model && (!provider || item.provider === provider));
      if (!matches.length) errors.push(`${label}: '${provider ? `${provider}/` : ''}${choice.model}' is absent from the Pi registry snapshot`);
      else if (matches.length > 1) errors.push(`${label}: model '${choice.model}' has multiple providers; set provider explicitly`);
      else model = matches[0];
      if (model?.thinkingLevels) {
        if (!model.thinkingLevels.includes(choice.effort)) errors.push(`${label}: thinking '${choice.effort}' is unsupported; advertised: ${model.thinkingLevels.join(', ') || '(none)'}. Refusing a route that Pi would clamp.`);
      } else if (model) warnings.push(`${label}: snapshot does not advertise thinkingLevels; thinking support is unverified`);
    }
    rows.push({ role: label, agent: choice.nativeRole, model: choice.model, thinking: choice.effort, provider: model?.provider ?? provider ?? 'active parent provider' });
    if (choice.role !== 'orchestrator' && settings.subagents?.agentOverrides?.[choice.nativeRole]) {
      warnings.push(`${label}: Pi settings override '${choice.nativeRole}'; inspect its effective model, thinking and tools before dispatch`);
    }
  }
  if (settings.subagents?.agentOverridesByProvider) {
    warnings.push('Provider-scoped Pi role overrides are configured; inspect the active provider mapping before dispatch.');
  }
  if (settings.subagents?.defaultExtensions || settings.subagents?.defaultSubagentOnlyExtensions) {
    warnings.push('Pi child extension defaults are configured; confirm the model provider and all four pi-web-access tools load in tr_search background children.');
  }
  warnings.push('Static checks do not prove pi-subagents loading, credentials, background-runner support, project overrides or a successful dispatch. Run /subagents-doctor and inspect capabilities in Pi.');
  warnings.push('Pi tool allowlists do not reproduce Codex OS sandboxes. Verification bash can write files; no-source-edit is a role contract.');
  return { errors, warnings, rows, catalogPath };
}
