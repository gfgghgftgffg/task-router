import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'smol-toml';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ROLE_META = {
  coding: { description: 'Implement bounded code and tests from supplied evidence and acceptance criteria.', sandbox: 'workspace-write' },
  search: { description: 'Read-only repository exploration, source research, and evidence gathering.', sandbox: 'read-only' },
  verify: { description: 'Independently verify changed behavior; run checks without editing source.', sandbox: 'workspace-write' },
  reasoning: { description: 'Resolve a bounded difficult decision or independent high-risk review; no coding.', sandbox: 'read-only' },
  general: { description: 'Produce non-coding summaries, prose, structured information, and analysis.', sandbox: 'workspace-write' },
};
const START = '<!-- task-router:start -->';
const END = '<!-- task-router:end -->';
// Blocks written before the rename still have to be recognised. Otherwise a new
// marker would append a second managed block and leave the old one behind in every
// Codex home that already had one.
export const LEGACY_MARKERS = [{ start: '<!-- codex-task-router:start -->', end: '<!-- codex-task-router:end -->' }];
const MANIFEST = '.task-router/manifest.json';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = p => fs.readFileSync(p, 'utf8');
export const defaultCodexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

export function activationInstructions(profile) {
  return [
    `The task-routing profile "${profile}" is active.`,
    'Before implementing or delegating, the parent reads the installed task-routing skill (skills/task-routing/SKILL.md under CODEX_HOME) and follows its generated role map.',
    'Route every code change, including small fixes, to the configured coding role and actually invoke it; every completed coding work unit needs an independent verify verdict.',
    'Assigned children stay inside their brief and do not start routing workflows of their own.',
    'User instructions and host permissions take precedence.',
  ].join(' ');
}

export function readBaseInstructions(codexHome) {
  const target = safeTarget(codexHome, 'config.toml');
  if (!fs.existsSync(target)) return { target, content: undefined, text: '' };
  const content = read(target);
  let parsed;
  try {
    parsed = parse(content.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Cannot parse ${target}: ${error.message}`);
  }
  return { target, content, text: typeof parsed.developer_instructions === 'string' ? parsed.developer_instructions : '' };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fields(value, allowed, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label}: expected a table`);
  for (const key of Object.keys(value)) assert(allowed.includes(key), `${label}: unknown setting '${key}'`);
}

const OPTION_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const AUTO_ID_PROVIDER = '<inherited>';

function modelFields(value, label) {
  for (const key of ['model', 'effort']) {
    assert(typeof value[key] === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/.test(value[key]), `${label}.${key}: expected a non-empty model/effort identifier`);
  }
  if (value.provider !== undefined) assert(typeof value.provider === 'string' && /^[a-zA-Z0-9_-]+$/.test(value.provider), `${label}.provider: invalid provider ID`);
}

function whenField(value, label) {
  if (value.when === undefined) return;
  assert(typeof value.when === 'string' && value.when.trim() !== '' && !/[\r\n]/.test(value.when), `${label}.when: expected a non-empty single-line selection hint`);
}

function modelConfig(value, label) {
  fields(value, ['model', 'effort', 'provider'], label);
  modelFields(value, label);
}

function resolveRoleCandidates(value, label) {
  fields(value, ['model', 'effort', 'provider', 'when', 'options'], label);
  modelFields(value, label);
  whenField(value, label);
  const candidates = [{ id: 'default', model: value.model, effort: value.effort, provider: value.provider, when: value.when }];
  if (value.options === undefined) return candidates;
  assert(Array.isArray(value.options), `${label}.options: expected an array of tables`);
  const seen = new Map();
  const tuples = new Map();
  value.options.forEach((option, index) => {
    const optionLabel = `${label}.options[${index}]`;
    fields(option, ['id', 'model', 'effort', 'provider', 'when'], optionLabel);
    modelFields(option, optionLabel);
    whenField(option, optionLabel);
    if (option.id !== undefined) {
      assert(typeof option.id === 'string' && OPTION_ID.test(option.id), `${optionLabel}.id: expected a lowercase identifier starting with a letter`);
      assert(option.id !== 'default', `${optionLabel}.id: 'default' is reserved for the role's base candidate`);
    }
    const tuple = JSON.stringify([option.model, option.effort, option.provider ?? AUTO_ID_PROVIDER]);
    if (option.id === undefined && tuples.has(tuple)) {
      throw new Error(`${optionLabel}.id: duplicate option model/effort/provider tuple from ${tuples.get(tuple)}; give one candidate an explicit id`);
    }
    const id = option.id ?? `auto_${hash(tuple).slice(0, 16)}`;
    if (seen.has(id)) {
      const previous = seen.get(id);
      if (option.id !== undefined && previous.explicit) throw new Error(`${optionLabel}.id: duplicate option id '${id}'`);
      throw new Error(`${optionLabel}.id: collides with ${previous.explicit ? 'explicit' : 'automatic'} candidate id '${id}' from ${previous.label}`);
    }
    if (option.id === undefined) tuples.set(tuple, optionLabel);
    seen.set(id, { label: optionLabel, explicit: option.id !== undefined });
    candidates.push({ id, model: option.model, effort: option.effort, provider: option.provider, when: option.when });
  });
  return candidates;
}

function roleConfig(value, label) {
  resolveRoleCandidates(value, label);
}

export function loadConfig(filename) {
  const c = parse(read(filename).replace(/^\uFEFF/, ''));
  fields(c, ['version', 'profile', 'max_concurrent', 'max_coding_repairs', 'orchestrator', 'roles'], 'routing');
  assert(c.version === 1, 'version must be 1');
  assert(typeof c.profile === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(c.profile), 'profile must be a lowercase name, not a path');
  assert(Number.isInteger(c.max_concurrent) && c.max_concurrent >= 1 && c.max_concurrent <= 32, 'max_concurrent must be 1..32');
  assert(Number.isInteger(c.max_coding_repairs) && c.max_coding_repairs >= 0 && c.max_coding_repairs <= 5, 'max_coding_repairs must be 0..5');
  modelConfig(c.orchestrator, 'orchestrator');
  fields(c.roles, Object.keys(ROLE_META), 'roles');
  for (const role of Object.keys(ROLE_META)) roleConfig(c.roles[role], `roles.${role}`);
  return c;
}

export function getRoleChoices(c) {
  const choices = [];
  for (const role of Object.keys(ROLE_META)) {
    for (const candidate of resolveRoleCandidates(c.roles[role], `roles.${role}`)) {
      choices.push({ role, ...candidate, nativeRole: candidate.id === 'default' ? `tr_${role}` : `tr_${role}_${candidate.id}` });
    }
  }
  return choices;
}

function nativeModel(settings) {
  return {
    model: settings.model,
    model_reasoning_effort: settings.effort,
    ...(settings.provider ? { model_provider: settings.provider } : {}),
  };
}

export function render(c, options = {}) {
  const files = new Map();
  const activation = activationInstructions(c.profile);
  const base = typeof options.baseInstructions === 'string' ? options.baseInstructions : '';
  const choices = getRoleChoices(c);
  const profile = {
    ...nativeModel(c.orchestrator),
    developer_instructions: base ? base + (base.endsWith('\n') ? '\n' : '\n\n') + activation : activation,
    agents: {
      enabled: true,
      max_concurrent_threads_per_session: c.max_concurrent,
      default_subagent_model: c.roles.search.model,
      default_subagent_reasoning_effort: c.roles.search.effort,
    },
  };
  const rows = [];
  for (const [role, meta] of Object.entries(ROLE_META)) {
    const contract = read(path.join(ROOT, 'roles', `${role}.md`));
    for (const choice of choices.filter(choice => choice.role === role)) {
      const nativePath = `agents/task-routing/${choice.id === 'default' ? role : `${role}_${choice.id}`}.toml`;
      profile.agents[choice.nativeRole] = { description: meta.description, config_file: nativePath };
      files.set(nativePath, stringify({ name: choice.nativeRole, description: meta.description, ...nativeModel(choice), sandbox_mode: meta.sandbox, developer_instructions: contract }));
      rows.push(`| ${choice.id === 'default' ? role : `${role} (${choice.id})`} | ${choice.nativeRole} | ${choice.model} | ${choice.effort} | ${choice.provider || 'inherit active provider'} | ${choice.when ? choice.when.replace(/\|/g, '\\|') : '-'} | [contract](roles/${role}.md) |`);
    }
    files.set(`skills/task-routing/references/roles/${role}.md`, contract);
  }
  files.set(`${c.profile}.config.toml`, '# Generated from routing.toml. Rebuild to change models or efforts.\n' + stringify(profile));
  for (const relative of ['SKILL.md', 'references/coding-quality.md', 'references/parallel-work.md', 'references/orchestration.md', 'references/research-evidence.md', 'agents/openai.yaml']) {
    files.set(`skills/task-routing/${relative}`, read(path.join(ROOT, 'skill', relative)));
  }
  files.set('skills/task-routing/references/role-map.md', [
    '# Configured roles', '',
    'Generated from routing.toml. Each role has a base candidate and may have named candidates that share the same contract and sandbox. The orchestrator picks among the listed candidates by task complexity, risk, context volume, and economy instead of using the strongest candidate for every task. Selection happens in the parent at dispatch time; this generator neither classifies tasks nor intercepts runtime calls.', '',
    'An explicit user model or effort instruction overrides the corresponding default only within its stated task or role scope; other settings remain unchanged. When a request matches a candidate, prefer its named role, and report an unsupported ad-hoc override instead of silently substituting another model. Examples and a parent-model selection alone are not child overrides. Do not rewrite persistent configuration for a one-off request.', '',
    `Parent profile: ${c.profile}; model: ${c.orchestrator.model}; effort: ${c.orchestrator.effort}.`,
    `Maximum concurrent children: ${c.max_concurrent}. Maximum coding repair follow-ups per work unit: ${c.max_coding_repairs}.`, '',
    '| Work | Native role | Model | Effort | Provider | When | Instructions |',
    '| --- | --- | --- | --- | --- | --- | --- |', ...rows, '',
    'Named roles carry their provider, sandbox, and instructions. A model-only spawn is not equivalent when it cannot preserve these settings.',
    'Use supported per-spawn model/effort overrides for explicit user choices. If named roles are unavailable, read the selected contract and explicitly select the effective model and effort only when the host can enforce the required provider and permissions.',
    'Continue related work with a suitable owner through its known ID using send_input. Independent new tasks start fresh; fork only when most parent history is relevant and the host preserves the selected role, model/effort, provider, and permissions. Follow [the context, isolation, and lifecycle rules](parallel-work.md) for dispatch checks, resume limits, and sharing.',
    'Choose the current phase\'s execution shape separately from model tier under [phase-level orchestration](orchestration.md). Check actual delegation capabilities, not host/plugin names: with both direct subagents and workflows choose by decision structure; with one use it for bounded phases; with neither report required delegation as unavailable. Preserve routes, acceptance, aggregate concurrency and repair limits.',
    'If the effective model, effort, or role is rejected, report the exact route and failure. Do not silently fall back to the default, fabricate success, use an unnamed inherited-model fork, or weaken permissions.', '',
  ].join('\n'));
  files.set('AGENTS.md', [START,
    'When the task-routing profile is active or the user invokes $task-routing, use that skill for delegation. Otherwise keep the existing workflow.',
    'Its role map defines defaults. Explicit user model/effort instructions take precedence for their stated task or role scope without changing persistent settings. Preserve host permissions and project constraints; report unsupported choices instead of silently substituting models.',
    'Choose among the role map candidates by task complexity, risk, context volume, and economy; do not use the strongest candidate for every task by default.',
    'The parent owns direction and decisions; assigned children follow their role without recursively orchestrating. Load only the role and workflow guidance needed for this task.',
    'Choose among available direct-subagent and workflow operations by decision structure and useful batching, not agent count or number of steps. If only one is available, use it for bounded phases; do not invent the other. Reassess at safe phase boundaries; independent coding acceptance remains required.',
    'Research summaries are navigation aids. Before important evidence-based decisions, the main agent reads the relevant originals and checks coverage; another child does not replace this judgment.',
    'Within the authorized task, continue through the requested deliverable and relevant acceptance checks, fixing failures caused by the change. Do not stop at a first draft or add routine approval checkpoints. Report concrete blockers and unverified requirements.',
    'Match reading and verification to the task. Do not force every role, a full-repository survey, repeated successful checks, or unrelated improvements. Completion does not expand scope or external-action permissions.',
    END, '',
  ].join('\n'));
  return files;
}

export function inspectCatalog(c, codexHome, catalogOverride) {
  const errors = [], warnings = [], rows = [];
  const configPath = path.join(codexHome, 'config.toml');
  const base = fs.existsSync(configPath) ? parse(read(configPath).replace(/^\uFEFF/, '')) : {};
  const catalogPath = catalogOverride ? path.resolve(catalogOverride)
    : base.model_catalog_json ? path.resolve(codexHome, base.model_catalog_json) : undefined;
  let catalog;
  if (catalogPath && fs.existsSync(catalogPath)) {
    catalog = JSON.parse(read(catalogPath).replace(/^\uFEFF/, ''));
    assert(Array.isArray(catalog.models), 'Model catalog must contain a models array');
  } else warnings.push('No configured model catalog found; model availability and effort support are unverified.');
  const orchestrator = { role: 'orchestrator', id: 'default', nativeRole: 'orchestrator', model: c.orchestrator.model, effort: c.orchestrator.effort, provider: c.orchestrator.provider };
  for (const candidate of [orchestrator, ...getRoleChoices(c)]) {
    const label = candidate.role === 'orchestrator' ? 'orchestrator' : candidate.id === 'default' ? `roles.${candidate.role}` : `roles.${candidate.role}.options.${candidate.id}`;
    const provider = candidate.provider || c.orchestrator.provider || base.model_provider || 'openai';
    if (provider !== 'openai' && provider !== 'ollama' && provider !== 'lmstudio' && !base.model_providers?.[provider]) {
      errors.push(`${label}: provider '${provider}' is not defined in the existing Codex config`);
    }
    const model = catalog?.models.find(m => m.slug === candidate.model);
    if (catalog && !model) errors.push(`${label}: '${candidate.model}' is absent from the configured model catalog`);
    if (model) {
      const efforts = (model.supported_reasoning_levels || []).map(v => typeof v === 'string' ? v : v.effort);
      if (efforts.length && !efforts.includes(candidate.effort)) errors.push(`${label}: effort '${candidate.effort}' is unsupported; advertised: ${efforts.join(', ')}`);
      if (!efforts.length) warnings.push(`${label}: catalog does not advertise reasoning levels`);
    }
    rows.push({ role: candidate.role === 'orchestrator' ? 'orchestrator' : candidate.id === 'default' ? candidate.role : `${candidate.role}:${candidate.id}`, nativeRole: candidate.nativeRole, model: candidate.model, effort: candidate.effort, provider });
  }
  if (c.roles.search.provider && c.roles.search.provider !== (c.orchestrator.provider || base.model_provider || 'openai')) {
    warnings.push('Search uses another provider. Unnamed child defaults cannot select that provider; always use named roles.');
  }
  warnings.push('Catalog checks do not prove server access or live subagent support. Restart Codex after installation and verify the first real dispatch.');
  return { errors, warnings, rows, catalogPath };
}

function markerSpan(existing, markers) {
  const { start: startMarker, end: endMarker } = markers;
  const starts = existing.split(startMarker).length - 1;
  const ends = existing.split(endMarker).length - 1;
  assert(starts === ends && starts <= 1, 'AGENTS.md contains ambiguous task-router markers');
  if (!starts) return undefined;
  const start = existing.indexOf(startMarker), end = existing.indexOf(endMarker);
  assert(end > start, 'AGENTS.md task-router markers are out of order');
  return { start, end: end + endMarker.length };
}

export function mergeAgents(existing, block, markers = { start: START, end: END }, legacy = []) {
  const spans = [markerSpan(existing, markers), ...legacy.map(m => markerSpan(existing, m))].filter(Boolean);
  assert(spans.length <= 1, 'AGENTS.md contains more than one managed task-router block');
  if (!spans.length) return existing + (existing && !existing.endsWith('\n') ? '\n' : '') + (existing ? '\n' : '') + block;
  const { start, end } = spans[0];
  return existing.slice(0, start) + block.trimEnd() + existing.slice(end);
}

export function safeTarget(root, relative) {
  assert(!path.isAbsolute(relative) && !relative.split(/[\\/]/).some(p => p === '..' || p === ''), `Unsafe managed path: ${relative}`);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  assert(target.startsWith(resolvedRoot + path.sep), `Path escapes target: ${relative}`);
  let current = target;
  while (current !== resolvedRoot) {
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat) assert(!stat.isSymbolicLink(), `Refusing symlink/junction: ${current}`);
    current = path.dirname(current);
  }
  return target;
}

function writeAtomic(target, content) {
  const temporary = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

const CANDIDATE_PATH = new RegExp(`^agents/task-routing/(?:${Object.keys(ROLE_META).join('|')})_[a-z][a-z0-9_-]*\\.toml$`);

export function planInstall(files, home, options = {}) {
  const manifestRelative = options.manifestPath ?? MANIFEST;
  const manifestPath = safeTarget(home, manifestRelative);
  const stalePattern = options.stalePattern ?? CANDIDATE_PATH;
  const mergeInstructions = options.mergeAgents ?? ((existing, block) => mergeAgents(existing, block, { start: START, end: END }, LEGACY_MARKERS));
  const base = options.base ?? readBaseInstructions(home);
  // The base config and every managed target are captured as preimages, so a plan
  // that would write nothing is still rejected once anything it read has changed.
  const guards = [{ target: base.target, old: base.content, label: 'Base config' }];
  let previous = { version: 1, files: {} };
  if (fs.existsSync(manifestPath)) {
    previous = JSON.parse(read(manifestPath));
    assert(previous.version === 1 && previous.files && typeof previous.files === 'object' && !Array.isArray(previous.files), 'Invalid install manifest');
  }
  const changes = [];
  const hashes = {};
  for (const [relative, generated] of files) {
    const target = safeTarget(home, relative);
    const exists = fs.existsSync(target);
    const old = exists ? read(target) : undefined;
    guards.push({ target, old, label: 'Managed file' });
    let content = generated;
    if (relative === 'AGENTS.md') content = mergeInstructions(old || '', generated);
    else if (exists && old !== generated) {
      assert(previous.files[relative] && hash(old) === previous.files[relative], `Preserving unowned or edited file: ${target}`);
    }
    hashes[relative] = hash(content);
    if (old !== content) changes.push({ relative, target, content, old });
  }
  for (const relative of Object.keys(previous.files)) {
    if (files.has(relative)) continue;
    // Removing candidates, and a backend's explicitly declared legacy layout,
    // are the only managed deletions. Each backend restricts its own namespace
    // and requires unchanged recorded hashes; edited/unowned paths are never removed.
    assert(stalePattern.test(relative), `Previously managed path would become stale: ${relative}. Keep the profile name stable or use a separate host home.`);
    const target = safeTarget(home, relative);
    const old = fs.existsSync(target) ? read(target) : undefined;
    if (old === undefined) {
      // Guard the missing path too: a file recreated after planning must fail the apply.
      guards.push({ target, old: undefined, label: 'Managed file' });
      continue;
    }
    assert(hash(old) === previous.files[relative], `Preserving edited candidate file: ${target}`);
    guards.push({ target, old, label: 'Managed file' });
    changes.push({ relative, target, old, content: undefined });
  }
  const manifest = JSON.stringify({ version: 1, files: hashes }, null, 2) + '\n';
  const oldManifest = fs.existsSync(manifestPath) ? read(manifestPath) : undefined;
  guards.push({ target: manifestPath, old: oldManifest, label: 'Managed file' });
  if (manifest !== oldManifest) changes.push({ relative: manifestRelative, target: manifestPath, content: manifest, old: oldManifest });
  Object.defineProperty(changes, 'guards', { value: guards });
  return changes;
}

export function applyInstall(changes, home) {
  for (const guard of changes.guards ?? []) {
    const actual = fs.existsSync(guard.target) ? read(guard.target) : undefined;
    assert(actual === guard.old, `${guard.label} changed after planning: ${guard.target}`);
  }
  if (!changes.length) return { written: 0, backup: null };
  // Verify every preimage before writing, so a stale plan never overwrites newer edits.
  for (const change of changes) {
    safeTarget(home, change.relative);
    const actual = fs.existsSync(change.target) ? read(change.target) : undefined;
    assert(actual === change.old, `Target changed after planning: ${change.target}`);
  }
  const backupRelative = `.task-router/backups/${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const backup = safeTarget(home, backupRelative);
  const applied = [];
  try {
    for (const change of changes) {
      if (change.old !== undefined) {
        const dest = safeTarget(home, `${backupRelative}/${change.relative}`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, change.old, { flag: 'wx', mode: 0o600 });
      }
      fs.mkdirSync(path.dirname(change.target), { recursive: true });
      if (change.content === undefined) fs.unlinkSync(change.target);
      else writeAtomic(change.target, change.content);
      applied.push(change);
    }
  } catch (error) {
    for (const change of applied.reverse()) {
      if (change.old === undefined) {
        if (fs.existsSync(change.target)) fs.unlinkSync(change.target);
      }
      else writeAtomic(change.target, change.old);
    }
    throw error;
  }
  return { written: changes.length, backup: fs.existsSync(backup) ? backup : null };
}
