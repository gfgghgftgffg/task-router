import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse, stringify } from 'smol-toml';
import { ROOT, ROLE_META, loadConfig, render, inspectCatalog, planInstall, applyInstall, getRoleChoices } from '../src/router.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const baseConfig = () => loadConfig(path.join(ROOT, 'routing.toml'));
// Candidate behavior gets its own candidates so the shipped, user-editable
// routing.toml is not asserted as the only legal model/id combination.
const candidateConfig = () => {
  const c = baseConfig();
  c.orchestrator.model = 'fixture-orchestrator';
  c.orchestrator.effort = 'medium';
  for (const [role, settings] of Object.entries(c.roles)) {
    settings.model = `fixture-${role}`;
    settings.effort = 'medium';
    delete settings.when;
    delete settings.options;
  }
  c.roles.coding.options = [
    { id: 'small', model: 'fixture-coding-small', effort: 'low', when: 'small fixture change' },
    { id: 'deep', model: 'fixture-coding-deep', effort: 'high', when: 'deep fixture change' },
  ];
  c.roles.search.options = [{ id: 'lookup', model: 'fixture-search-lookup', effort: 'medium', when: 'fixture lookup' }];
  c.roles.verify.options = [{ id: 'strict', model: 'fixture-verify-strict', effort: 'high', when: 'fixture check' }];
  return c;
};
const legacyConfig = () => {
  const c = baseConfig();
  for (const settings of Object.values(c.roles)) {
    delete settings.options;
    delete settings.when;
  }
  return c;
};

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-router-choices-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(root, relative, content) {
  const p = path.join(root, relative);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
function nativePath(choice) {
  return choice.id === 'default' ? `agents/task-routing/${choice.role}.toml` : `agents/task-routing/${choice.role}_${choice.id}.toml`;
}
function writeConfig(dir, name, c) {
  return put(dir, name, stringify(c));
}
function optionsFor(c, role, id) {
  return c.roles[role].options.find(option => option.id === id);
}
const autoConfig = () => {
  const c = candidateConfig();
  for (const settings of Object.values(c.roles)) {
    for (const option of settings.options ?? []) delete option.id;
  }
  return c;
};
function inlineConfigText() {
  return `version = 1
profile = "fixture-inline"
max_concurrent = 3
max_coding_repairs = 1

[orchestrator]
model = "fixture-orchestrator"
effort = "medium"

[roles.coding]
model = "fixture-coding"
effort = "medium"
options = [
  { model = "fixture-coding-low", effort = "low", when = "fixture low" },
  { model = "fixture-coding-high", effort = "high", when = "fixture high" }
]

[roles.search]
model = "fixture-search"
effort = "medium"

[roles.verify]
model = "fixture-verify"
effort = "medium"

[roles.reasoning]
model = "fixture-reasoning"
effort = "medium"

[roles.general]
model = "fixture-general"
effort = "medium"
`;
}
function automaticIdFor(option) {
  const c = autoConfig();
  c.roles.coding.options = [option];
  return getRoleChoices(c).find(choice => choice.role === 'coding' && choice.id !== 'default').id;
}

test('all candidates render native roles that keep their role contract and sandbox', () => {
  const c = candidateConfig();
  const files = render(c);
  const choices = getRoleChoices(c);
  const profile = parse(files.get('task-routing.config.toml'));
  for (const choice of choices) {
    const relative = nativePath(choice);
    const declaration = profile.agents[choice.nativeRole];
    assert.ok(declaration, `${choice.nativeRole} must be registered`);
    assert.equal(declaration.config_file, relative);
    const native = parse(files.get(relative));
    assert.equal(native.name, choice.nativeRole);
    assert.equal(native.model, choice.model);
    assert.equal(native.model_reasoning_effort, choice.effort);
    assert.equal(native.sandbox_mode, ROLE_META[choice.role].sandbox);
    assert.ok(native.developer_instructions.endsWith(fs.readFileSync(path.join(ROOT, 'roles', `${choice.role}.md`), 'utf8')));
    assert.match(native.developer_instructions, /^Before starting work, read and follow `/);
    assert.equal(native.when, undefined, 'when is a routing hint, not a native setting');
    assert.ok(native.description.trim());
  }
  for (const role of Object.keys(ROLE_META)) {
    const rendered = choices.filter(choice => choice.role === role).map(choice => parse(files.get(nativePath(choice))));
    assert.equal(new Set(rendered.map(native => native.sandbox_mode)).size, 1, `${role} candidates must share one sandbox`);
    assert.equal(new Set(rendered.map(native => native.developer_instructions)).size, 1, `${role} candidates must share one contract`);
  }
  assert.ok(files.has('agents/task-routing/coding.toml'));
  assert.ok(files.has('agents/task-routing/coding_small.toml'));
  assert.ok(files.has('agents/task-routing/coding_deep.toml'));
  assert.ok(files.has('agents/task-routing/search_lookup.toml'));
  assert.ok(files.has('agents/task-routing/verify_strict.toml'));
  const roleMap = files.get('skills/task-routing/references/role-map.md');
  for (const choice of choices) assert.ok(roleMap.includes(choice.nativeRole), `${choice.nativeRole} must appear in the role map`);
  assert.match(roleMap, /complexity, risk, context volume, and economy/);
  assert.match(roleMap, /strongest candidate for every task/);
  assert.match(roleMap, /report an unsupported ad-hoc override/);
  assert.match(roleMap, /neither classifies tasks nor intercepts runtime calls/);
  assert.equal(files.get('skills/task-routing/references/parallel-work.md'), fs.readFileSync(path.join(ROOT, 'skill', 'references', 'parallel-work.md'), 'utf8'));
  assert.equal(profile.agents.default_subagent_model, c.roles.search.model);
});

test('inline option arrays without ids load and render valid unique native roles', t => {
  const c = loadConfig(put(fixture(t), 'inline.toml', inlineConfigText()));
  const choices = getRoleChoices(c);
  const named = choices.filter(choice => choice.id !== 'default');
  assert.equal(choices.length, Object.keys(ROLE_META).length + 2);
  assert.equal(named.length, 2);
  for (const choice of named) {
    assert.match(choice.id, /^auto_[0-9a-f]{16}$/);
    assert.ok(choice.id.length <= 32);
    assert.ok(choice.id.startsWith('auto_'));
  }
  assert.equal(new Set(named.map(choice => choice.id)).size, named.length);
  assert.equal(new Set(named.map(choice => choice.nativeRole)).size, named.length);

  const files = render(c);
  const profile = parse(files.get('fixture-inline.config.toml'));
  for (const choice of named) {
    const relative = nativePath(choice);
    assert.equal(profile.agents[choice.nativeRole].config_file, relative);
    assert.equal(parse(files.get(relative)).name, choice.nativeRole);
  }
});

test('inline option arrays and repeated option tables parse equivalently without ids', t => {
  const dir = fixture(t);
  const inline = loadConfig(put(dir, 'inline.toml', inlineConfigText()));
  const repeated = loadConfig(put(dir, 'repeated.toml', stringify(inline)));
  assert.deepEqual(getRoleChoices(repeated), getRoleChoices(inline));
});

test('automatic ids ignore order, selection hints, and unrelated candidates', () => {
  const before = getRoleChoices(autoConfig());
  const changed = autoConfig();
  changed.roles.coding.options.reverse();
  for (const option of changed.roles.coding.options) option.when = `changed ${option.when}`;
  changed.roles.search.options.push({ model: 'fixture-search-extra', effort: 'low' });
  const after = getRoleChoices(changed);
  for (const choice of before.filter(choice => choice.role === 'coding' && choice.id !== 'default')) {
    const matching = after.find(candidate => candidate.role === 'coding'
      && candidate.model === choice.model
      && candidate.effort === choice.effort
      && candidate.provider === choice.provider);
    assert.ok(matching, `${choice.model}/${choice.effort} must remain present`);
    assert.equal(matching.id, choice.id);
  }
});

test('automatic ids stay distinct for provider, effort, and complex model identifiers', () => {
  const c = autoConfig();
  c.roles.coding.options = [
    { model: 'fixture-org/model:v2+alpha.beta', effort: 'high', provider: 'fixture_provider' },
    { model: 'fixture-org/model:v2+alpha.beta', effort: 'high' },
    { model: 'fixture-org/model:v2+alpha.beta', effort: 'low', provider: 'fixture_provider' },
  ];
  const choices = getRoleChoices(c).filter(choice => choice.role === 'coding' && choice.id !== 'default');
  assert.equal(choices.length, 3);
  assert.equal(new Set(choices.map(choice => choice.id)).size, 3);
  assert.equal(new Set(choices.map(choice => nativePath(choice))).size, 3);
  const files = render(c);
  for (const choice of choices) assert.equal(files.has(nativePath(choice)), true);
});

test('automatic ids reject duplicate tuples and explicit collisions', t => {
  const dir = fixture(t);
  const duplicate = autoConfig();
  duplicate.roles.coding.options = [
    { model: 'fixture-same', effort: 'low' },
    { model: 'fixture-same', effort: 'low', when: 'different hint' },
  ];
  assert.throws(() => loadConfig(writeConfig(dir, 'duplicate.toml', duplicate)), /duplicate option model\/effort\/provider tuple/);

  const automaticId = automaticIdFor({ model: 'fixture-collision', effort: 'low' });
  const automaticThenExplicit = autoConfig();
  automaticThenExplicit.roles.coding.options = [
    { model: 'fixture-collision', effort: 'low' },
    { id: automaticId, model: 'fixture-other', effort: 'high' },
  ];
  assert.throws(() => loadConfig(writeConfig(dir, 'automatic-then-explicit.toml', automaticThenExplicit)), /collides with automatic candidate id/);

  const explicitThenAutomatic = autoConfig();
  explicitThenAutomatic.roles.coding.options = [
    { id: automaticId, model: 'fixture-other', effort: 'high' },
    { model: 'fixture-collision', effort: 'low' },
  ];
  assert.throws(() => loadConfig(writeConfig(dir, 'explicit-then-automatic.toml', explicitThenAutomatic)), /collides with explicit candidate id/);
});

test('explicit option ids keep their legacy path', () => {
  const c = candidateConfig();
  const choice = getRoleChoices(c).find(candidate => candidate.nativeRole === 'tr_coding_small');
  assert.ok(choice);
  assert.equal(choice.id, 'small');
  assert.equal(nativePath(choice), 'agents/task-routing/coding_small.toml');
  assert.equal(render(c).has('agents/task-routing/coding_small.toml'), true);
});

test('candidate providers render per candidate and never leak into the contract', () => {
  const c = candidateConfig();
  optionsFor(c, 'coding', 'deep').provider = 'local_alt';
  const files = render(c);
  const strong = parse(files.get('agents/task-routing/coding_deep.toml'));
  const base = parse(files.get('agents/task-routing/coding.toml'));
  assert.equal(strong.model_provider, 'local_alt');
  assert.equal(base.model_provider, undefined);
  assert.equal(strong.developer_instructions, base.developer_instructions);
  const choices = getRoleChoices(c);
  assert.equal(choices.find(choice => choice.nativeRole === 'tr_coding_deep').provider, 'local_alt');
  assert.equal(choices.find(choice => choice.nativeRole === 'tr_coding_small').provider, undefined);
});

test('an option-free config still generates the original single-candidate bundle', () => {
  const c = legacyConfig();
  const files = render(c);
  const profile = parse(files.get('task-routing.config.toml'));
  const expectedNames = Object.keys(ROLE_META).map(role => `tr_${role}`).sort();
  assert.deepEqual(Object.keys(profile.agents).filter(name => name.startsWith('tr_')).sort(), expectedNames);
  assert.deepEqual([...files.keys()].filter(relative => relative.startsWith('agents/task-routing/')).sort(), Object.keys(ROLE_META).map(role => `agents/task-routing/${role}.toml`).sort());
  const choices = getRoleChoices(c);
  assert.equal(choices.length, Object.keys(ROLE_META).length);
  assert.ok(choices.every(choice => choice.id === 'default'));
});

test('doctor checks every candidate model, effort and provider', t => {
  const dir = fixture(t);
  const c = candidateConfig();
  optionsFor(c, 'coding', 'deep').model = 'fixture-missing';
  optionsFor(c, 'search', 'lookup').effort = 'nonexistent';
  optionsFor(c, 'verify', 'strict').provider = 'missing-provider';
  put(dir, 'config.toml', 'model_catalog_json = "models.json"\n');
  const models = [
    { slug: 'fixture-orchestrator', levels: ['medium'] },
    { slug: 'fixture-coding', levels: ['medium'] },
    { slug: 'fixture-coding-small', levels: ['low'] },
    { slug: 'fixture-search', levels: ['medium'] },
    { slug: 'fixture-search-lookup', levels: ['medium'] },
    { slug: 'fixture-verify', levels: ['medium'] },
    { slug: 'fixture-verify-strict', levels: ['high'] },
    { slug: 'fixture-reasoning', levels: ['medium'] },
    { slug: 'fixture-general', levels: ['medium'] },
  ].map(({ slug, levels }) => ({ slug, supported_reasoning_levels: levels.map(effort => ({ effort })) }));
  put(dir, 'models.json', JSON.stringify({ models }));
  const report = inspectCatalog(c, dir);
  const errors = report.errors.join('\n');
  assert.match(errors, /roles\.coding\.options\.deep: 'fixture-missing' is absent from/);
  assert.match(errors, /roles\.search\.options\.lookup: effort 'nonexistent' is unsupported/);
  assert.match(errors, /roles\.verify\.options\.strict: provider 'missing-provider' is not defined/);
  assert.equal(report.rows.length, getRoleChoices(c).length + 1);
  assert.equal(report.rows[1].nativeRole, 'tr_coding');
  assert.ok(report.rows.some(row => row.nativeRole === 'tr_coding_deep' && row.model === 'fixture-missing'));
});

test('invalid candidate settings are rejected', t => {
  const dir = fixture(t);
  const cases = [
    ['unknown root setting', c => { c.schedule = true; }, /unknown setting 'schedule'/],
    ['unknown role setting', c => { c.roles.coding.extra = true; }, /unknown setting 'extra'/],
    ['unknown option setting', c => { optionsFor(c, 'coding', 'small').extra = true; }, /unknown setting 'extra'/],
    ['reserved option id', c => { optionsFor(c, 'coding', 'small').id = 'default'; }, /'default' is reserved/],
    ['duplicate option ids', c => { optionsFor(c, 'coding', 'deep').id = 'small'; }, /duplicate option id 'small'/],
    ['unsafe option id', c => { optionsFor(c, 'coding', 'small').id = 'Fast!'; }, /lowercase identifier/],
    ['missing option effort', c => { delete optionsFor(c, 'coding', 'small').effort; }, /expected a non-empty model\/effort identifier/],
    ['removed parallel control layer', c => { c.parallel = { enabled: true }; }, /unknown setting 'parallel'/],
    ['empty when hint', c => { c.roles.search.when = '   '; }, /selection hint/],
  ];
  for (const [name, mutate, pattern] of cases) {
    const c = candidateConfig();
    mutate(c);
    assert.throws(() => loadConfig(writeConfig(dir, `${name.replace(/[^a-z]+/g, '-')}.toml`, c)), pattern, name);
  }
  assert.equal(parse(fs.readFileSync(path.join(ROOT, 'routing.toml'), 'utf8')).parallel, undefined);
});

test('installing a no-id config deletes the old explicit path with backup and stays idempotent', t => {
  const dir = fixture(t);
  const before = candidateConfig();
  const beforeFiles = render(before);
  applyInstall(planInstall(beforeFiles, dir), dir);
  const oldRelative = 'agents/task-routing/coding_small.toml';
  const oldTarget = path.join(dir, oldRelative);
  const oldContent = fs.readFileSync(oldTarget, 'utf8');

  const after = autoConfig();
  const afterFiles = render(after);
  const replacement = getRoleChoices(after).find(choice => choice.role === 'coding'
    && choice.model === 'fixture-coding-small'
    && choice.effort === 'low');
  assert.ok(replacement);
  const newRelative = nativePath(replacement);
  const plan = planInstall(afterFiles, dir);
  const deletion = plan.find(change => change.relative === oldRelative);
  assert.ok(deletion, 'the old explicit candidate must be planned for deletion');
  assert.equal(deletion.content, undefined);
  assert.equal(fs.existsSync(oldTarget), true, 'planning must not delete the old path');
  assert.equal(fs.existsSync(path.join(dir, newRelative)), false, 'planning must not create the new path');

  const preview = spawnSync(process.execPath, [
    path.join(ROOT, 'cli.mjs'), 'install',
    '--config', writeConfig(dir, 'after-auto.toml', after),
    '--codex-home', dir,
  ], { encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /DELETE agents\/task-routing\/coding_small\.toml/);
  assert.equal(fs.readFileSync(oldTarget, 'utf8'), oldContent, 'preview must not write');
  assert.equal(fs.existsSync(path.join(dir, newRelative)), false, 'preview must not create the new path');

  const result = applyInstall(plan, dir);
  assert.ok(result.backup);
  assert.equal(fs.existsSync(oldTarget), false);
  assert.equal(fs.readFileSync(path.join(result.backup, oldRelative), 'utf8'), oldContent);
  assert.equal(fs.existsSync(path.join(dir, newRelative)), true);
  const profile = parse(fs.readFileSync(path.join(dir, 'task-routing.config.toml'), 'utf8'));
  assert.ok(profile.agents[replacement.nativeRole], 'the replacement native role must appear');
  assert.equal(planInstall(afterFiles, dir).length, 0, 'a second install must be a no-op');
});

test('an edited legacy candidate blocks no-id migration and is preserved', t => {
  const dir = fixture(t);
  applyInstall(planInstall(render(candidateConfig()), dir), dir);
  const oldRelative = 'agents/task-routing/coding_small.toml';
  const oldTarget = path.join(dir, oldRelative);
  fs.appendFileSync(oldTarget, '\n# manual change\n');
  const edited = fs.readFileSync(oldTarget, 'utf8');
  const after = autoConfig();
  const replacement = getRoleChoices(after).find(choice => choice.role === 'coding'
    && choice.model === 'fixture-coding-small'
    && choice.effort === 'low');
  assert.throws(() => planInstall(render(after), dir), /Preserving edited candidate file/);
  assert.equal(fs.readFileSync(oldTarget, 'utf8'), edited);
  assert.equal(fs.existsSync(path.join(dir, nativePath(replacement))), false);
});

test('removing a candidate previews DELETE, backs up, applies and stays idempotent', t => {
  const dir = fixture(t);
  const before = candidateConfig();
  applyInstall(planInstall(render(before), dir), dir);
  const target = path.join(dir, 'agents/task-routing/coding_deep.toml');
  const original = fs.readFileSync(target, 'utf8');
  const manifestPath = path.join(dir, '.task-router/manifest.json');
  const manifestBefore = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifestBefore.files['agents/task-routing/coding_deep.toml'], sha(original));

  const after = candidateConfig();
  after.roles.coding.options = after.roles.coding.options.filter(option => option.id !== 'deep');
  const plan = planInstall(render(after), dir);
  const deletion = plan.find(change => change.relative === 'agents/task-routing/coding_deep.toml');
  assert.ok(deletion, 'the removed candidate must be planned for deletion');
  assert.equal(deletion.content, undefined);
  assert.equal(fs.readFileSync(target, 'utf8'), original, 'preview must not write');
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files['agents/task-routing/coding_deep.toml'], sha(original));
  assert.equal(planInstall(render(after), dir).find(change => change.relative === 'agents/task-routing/coding_deep.toml').old, original);
  const preview = spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), 'install', '--config', writeConfig(dir, 'after-removal.toml', after), '--codex-home', dir], { encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /DELETE agents\/task-routing\/coding_deep\.toml/);
  assert.equal(fs.readFileSync(target, 'utf8'), original, 'CLI preview must not write');

  const result = applyInstall(plan, dir);
  assert.ok(result.backup);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readFileSync(path.join(result.backup, 'agents/task-routing/coding_deep.toml'), 'utf8'), original);
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files['agents/task-routing/coding_deep.toml'], undefined);
  assert.equal(fs.existsSync(path.join(dir, 'agents/task-routing/coding_small.toml')), true);
  assert.equal(parse(fs.readFileSync(path.join(dir, 'task-routing.config.toml'), 'utf8')).agents.tr_coding_deep, undefined);
  assert.equal(planInstall(render(after), dir).length, 0, 'a second install must be a no-op');
});

test('an edited stale candidate is preserved and blocks the removal', t => {
  const dir = fixture(t);
  applyInstall(planInstall(render(candidateConfig()), dir), dir);
  const target = path.join(dir, 'agents/task-routing/coding_deep.toml');
  fs.appendFileSync(target, '\n# manual change\n');
  const edited = fs.readFileSync(target, 'utf8');
  const after = candidateConfig();
  after.roles.coding.options = after.roles.coding.options.filter(option => option.id !== 'deep');
  assert.throws(() => planInstall(render(after), dir), /Preserving edited candidate file/);
  assert.equal(fs.readFileSync(target, 'utf8'), edited);
});

test('a vanished stale candidate is guarded against recreation after planning', t => {
  const dir = fixture(t);
  applyInstall(planInstall(render(candidateConfig()), dir), dir);
  const target = path.join(dir, 'agents/task-routing/coding_deep.toml');
  fs.unlinkSync(target);
  const after = candidateConfig();
  after.roles.coding.options = after.roles.coding.options.filter(option => option.id !== 'deep');
  const plan = planInstall(render(after), dir);
  assert.equal(plan.some(change => change.relative === 'agents/task-routing/coding_deep.toml'), false, 'an already-missing file needs no delete change');
  put(dir, 'agents/task-routing/coding_deep.toml', '# recreated after planning\n');
  assert.throws(() => applyInstall(plan, dir), /changed after planning/);
  assert.equal(fs.readFileSync(target, 'utf8'), '# recreated after planning\n');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.task-router/manifest.json'), 'utf8')).files['agents/task-routing/coding_deep.toml']);
});

test('only known role candidate paths may be removed as stale managed files', t => {
  const dir = fixture(t), other = fixture(t);
  const notes = 'keep these notes\n';
  put(dir, 'notes.md', notes);
  put(dir, '.task-router/manifest.json', JSON.stringify({ version: 1, files: { 'notes.md': sha(notes) } }, null, 2));
  assert.throws(() => planInstall(new Map([['other.txt', 'x']]), dir), /Previously managed path would become stale/);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'), notes);

  const stray = 'agents/task-routing/coding_zz.toml';
  put(other, stray, '# not recorded by this installer\n');
  const plan = planInstall(render(legacyConfig()), other);
  assert.equal(plan.some(change => change.relative === stray), false);
  assert.equal(fs.existsSync(path.join(other, stray)), true);

  const base = fixture(t);
  const basePath = 'agents/task-routing/coding.toml';
  const baseContent = '# recorded base role\n';
  put(base, basePath, baseContent);
  put(base, '.task-router/manifest.json', JSON.stringify({ version: 1, files: { [basePath]: sha(baseContent) } }, null, 2));
  assert.throws(() => planInstall(new Map([['keep.txt', 'x']]), base), /Previously managed path would become stale/);
  assert.equal(fs.existsSync(path.join(base, basePath)), true);
});
