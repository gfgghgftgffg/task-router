import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse, stringify } from 'smol-toml';
import { ROOT, ROLE_META, loadConfig, render, inspectCatalog, mergeAgents, LEGACY_MARKERS, planInstall, applyInstall, activationInstructions, readBaseInstructions } from '../src/router.mjs';

const defaultConfig = () => loadConfig(path.join(ROOT, 'routing.toml'));
// Older coverage describes the single-candidate layout. Keep it on an explicit
// option-free fixture instead of inheriting whatever routing.toml ships.
const legacyConfig = () => {
  const c = defaultConfig();
  for (const settings of Object.values(c.roles)) {
    delete settings.options;
    delete settings.when;
  }
  return c;
};
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-router-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(root, relative, content) {
  const p = path.join(root, relative);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
function installPlan(c, home) {
  const base = readBaseInstructions(home);
  return { base, changes: planInstall(render(c, { baseInstructions: base.text }), home, { base }) };
}

test('all independently configured models, efforts and providers reach native role layers', () => {
  const c = legacyConfig();
  for (const [i, role] of Object.keys(ROLE_META).entries()) {
    c.roles[role] = { model: `custom/model-${i}`, effort: `level-${i}`, provider: `provider_${i}` };
  }
  const files = render(c);
  const profile = parse(files.get('task-routing.config.toml'));
  for (const [role, settings] of Object.entries(c.roles)) {
    const nativePath = profile.agents[`tr_${role}`].config_file;
    const actual = parse(files.get(nativePath));
    assert.equal(actual.model, settings.model);
    assert.equal(actual.model_reasoning_effort, settings.effort);
    assert.equal(actual.model_provider, settings.provider);
    assert.equal(actual.sandbox_mode, ROLE_META[role].sandbox);
    assert.ok(actual.developer_instructions.length > 100);
  }
  assert.equal(profile.agents.default_subagent_model, c.roles.search.model);
});

test('changing the coding model leaves every other role configuration unchanged', () => {
  const c = legacyConfig(), before = render(c);
  c.roles.coding.model = 'another-coder';
  c.roles.coding.effort = 'max';
  const after = render(c);
  for (const role of Object.keys(ROLE_META).filter(r => r !== 'coding')) {
    assert.equal(before.get(`agents/task-routing/${role}.toml`), after.get(`agents/task-routing/${role}.toml`));
  }
  assert.notEqual(before.get('agents/task-routing/coding.toml'), after.get('agents/task-routing/coding.toml'));
});

test('role files are self-describing for discovery without a profile name hint', () => {
  const files = render(legacyConfig());
  const profile = parse([...files.entries()].find(([p]) => p.endsWith('.config.toml'))[1]);
  const names = new Set();
  for (const [registeredName, declaration] of Object.entries(profile.agents)) {
    if (!registeredName.startsWith('tr_')) continue;
    const role = parse(files.get(declaration.config_file));
    assert.equal(role.name, registeredName, 'discovery and explicit registration must identify the same role');
    assert.equal(typeof role.description, 'string');
    assert.ok(role.description.trim(), 'discovery requires a description in the file itself');
    assert.ok(role.developer_instructions.trim());
    assert.equal(names.has(role.name), false, 'discovered role names must be unique');
    names.add(role.name);
  }
  assert.equal(names.size, 5);
});

test('configuration rejects misspelled roles, absent efforts and escaping profile names', t => {
  const dir = fixture(t);
  for (const mutate of [c => { c.roles.seach = c.roles.search; }, c => { delete c.roles.coding.effort; }, c => { c.profile = '../escape'; }]) {
    const c = legacyConfig(); mutate(c);
    const filename = put(dir, 'routing.toml', stringify(c));
    assert.throws(() => loadConfig(filename));
  }
});

test('configuration accepts provider-specific effort labels without a hardcoded enum', t => {
  const c = legacyConfig(); c.roles.coding.effort = 'adaptive';
  assert.equal(loadConfig(put(fixture(t), 'routing.toml', stringify(c))).roles.coding.effort, 'adaptive');
});

test('generated local skill references resolve inside the bundle', () => {
  const files = render(legacyConfig());
  for (const [relative, content] of files) {
    if (!relative.endsWith('.md')) continue;
    for (const match of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const referenced = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
      assert.ok(files.has(referenced), `${relative} references missing ${referenced}`);
    }
  }
});

test('preview writes nothing and install preserves existing base config and AGENTS text', t => {
  const dir = fixture(t);
  const base = '# existing provider and private settings\nmodel = "previous"\n';
  put(dir, 'config.toml', base);
  put(dir, 'AGENTS.md', 'Existing project preferences.\n');
  const files = render(legacyConfig());
  const changes = planInstall(files, dir);
  assert.equal(fs.existsSync(path.join(dir, 'task-routing.config.toml')), false);
  applyInstall(changes, dir);
  assert.equal(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), base);
  assert.ok(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').startsWith('Existing project preferences.\n'));
  assert.equal(planInstall(files, dir).length, 0);
});

test('updating owned models makes a backup and preserves AGENTS additions', t => {
  const dir = fixture(t), c = legacyConfig();
  c.roles.coding.effort = 'low';
  applyInstall(planInstall(render(c), dir), dir);
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nMy later instructions.\n');
  const previous = fs.readFileSync(path.join(dir, 'agents/task-routing/coding.toml'), 'utf8');
  c.roles.coding.effort = 'max';
  const result = applyInstall(planInstall(render(c), dir), dir);
  assert.ok(result.backup);
  assert.equal(fs.readFileSync(path.join(result.backup, 'agents/task-routing/coding.toml'), 'utf8'), previous);
  assert.ok(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').endsWith('My later instructions.\n'));
  assert.equal(parse(fs.readFileSync(path.join(dir, 'agents/task-routing/coding.toml'), 'utf8')).model_reasoning_effort, 'max');
});

test('unowned files and edited managed roles are refused before any writes', t => {
  const dir = fixture(t), files = render(legacyConfig());
  put(dir, 'task-routing.config.toml', '# another profile\n');
  assert.throws(() => planInstall(files, dir), /unowned or edited/);
  assert.equal(fs.existsSync(path.join(dir, 'agents')), false);
  fs.unlinkSync(path.join(dir, 'task-routing.config.toml'));
  applyInstall(planInstall(files, dir), dir);
  fs.appendFileSync(path.join(dir, 'agents/task-routing/coding.toml'), '\n# manual change\n');
  assert.throws(() => planInstall(files, dir), /unowned or edited/);
});

test('a stale plan cannot overwrite concurrent changes', t => {
  const dir = fixture(t), files = render(legacyConfig());
  const changes = planInstall(files, dir);
  put(dir, 'AGENTS.md', 'Written after preview.');
  assert.throws(() => applyInstall(changes, dir), /changed after planning/);
  assert.equal(fs.existsSync(path.join(dir, 'agents')), false);
});

test('ambiguous AGENTS markers and stale profile renames fail explicitly', t => {
  assert.throws(() => mergeAgents('<!-- task-router:start -->', 'x'), /ambiguous/);
  assert.throws(() => mergeAgents('<!-- task-router:start -->\n<!-- task-router:end -->\n<!-- task-router:start -->\n<!-- task-router:end -->', 'x'), /ambiguous|more than one/);
  const dir = fixture(t), c = legacyConfig();
  applyInstall(planInstall(render(c), dir), dir);
  c.profile = 'renamed';
  assert.throws(() => planInstall(render(c), dir), /stale/);
});

test('the renamed AGENTS marker replaces the block written by earlier versions', () => {
  const markers = { start: '<!-- task-router:start -->', end: '<!-- task-router:end -->' };
  const existing = 'User rules first.\n\n<!-- codex-task-router:start -->\nOld managed block.\n<!-- codex-task-router:end -->\n\nUser rules last.\n';
  const merged = mergeAgents(existing, '<!-- task-router:start -->\nNew block.\n<!-- task-router:end -->\n', markers, LEGACY_MARKERS);
  assert.ok(merged.startsWith('User rules first.'));
  assert.ok(merged.includes('User rules last.'));
  assert.ok(merged.includes('New block.'));
  assert.equal(merged.includes('Old managed block.'), false);
  assert.equal(merged.includes('codex-task-router'), false);
  assert.equal(merged.split(markers.start).length - 1, 1);
  // A home that already migrated must not gain a second block on the next install.
  const again = mergeAgents(merged, '<!-- task-router:start -->\nNewer block.\n<!-- task-router:end -->\n', markers, LEGACY_MARKERS);
  assert.equal(again.split(markers.start).length - 1, 1);
  assert.ok(again.includes('Newer block.'));
  assert.ok(again.includes('User rules first.'));
  // Two managed blocks are ambiguous rather than silently merged.
  assert.throws(() => mergeAgents(`${existing}\n${merged}`, 'x', markers, LEGACY_MARKERS), /more than one/);
});

test('an install migrates a legacy marker block in place and stays idempotent', t => {
  const dir = fixture(t), c = legacyConfig(), files = render(c);
  put(dir, 'AGENTS.md', 'Keep me.\n\n<!-- codex-task-router:start -->\nstale\n<!-- codex-task-router:end -->\n');
  applyInstall(planInstall(files, dir), dir);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith('Keep me.'));
  assert.equal(agents.includes('codex-task-router'), false);
  assert.equal(agents.includes('stale'), false);
  assert.equal(agents.split('<!-- task-router:start -->').length - 1, 1);
  assert.equal(planInstall(files, dir).filter(change => change.relative === 'AGENTS.md').length, 0);
});

test('unsafe manifest paths are rejected without writing outside the target', t => {
  const dir = fixture(t);
  assert.throws(() => planInstall(new Map([['../escape', 'no']]), dir), /Unsafe/);
});

test('directory links cannot redirect role installation', t => {
  const dir = fixture(t), other = fixture(t);
  fs.symlinkSync(other, path.join(dir, 'agents'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => planInstall(render(legacyConfig()), dir), /symlink\/junction/);
  assert.deepEqual(fs.readdirSync(other), []);
});

test('links above or at the target root are allowed', t => {
  const parent = fixture(t), actual = fixture(t);
  const alias = path.join(parent, 'alias');
  fs.symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const home = path.join(alias, 'home');
  const result = applyInstall(planInstall(render(legacyConfig()), home), home);
  assert.ok(result.written > 0);
  assert.ok(fs.existsSync(path.join(actual, 'home', 'agents/task-routing/coding.toml')));
  const rootResult = applyInstall(planInstall(new Map([['root-link-check', 'ok']]), alias), alias);
  assert.ok(rootResult.written > 0);
  assert.equal(fs.readFileSync(path.join(actual, 'root-link-check'), 'utf8'), 'ok');
});

test('doctor catches unavailable models and unsupported reasoning before installation', t => {
  const dir = fixture(t), c = legacyConfig();
  c.orchestrator = { model: 'gpt-6-astra', effort: 'medium' };
  c.roles.coding = { model: 'deepseek-flash', effort: 'low' };
  c.roles.search = c.roles.verify = c.roles.general = { model: 'gpt-6-sol', effort: 'medium' };
  c.roles.reasoning = { model: 'gpt-6-astra', effort: 'high' };
  put(dir, 'config.toml', 'model_catalog_json = "models.json"\n');
  put(dir, 'models.json', JSON.stringify({ models: [
    { slug: 'gpt-6-astra', supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'high' }] },
    { slug: 'gpt-6-sol', supported_reasoning_levels: [{ effort: 'medium' }] },
    { slug: 'deepseek-flash', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'max' }] },
  ] }));
  assert.deepEqual(inspectCatalog(c, dir).errors, []);
  c.roles.coding.effort = 'medium';
  assert.match(inspectCatalog(c, dir).errors.join('\n'), /unsupported/);
  c.roles.coding.model = 'absent';
  assert.match(inspectCatalog(c, dir).errors.join('\n'), /absent from/);
});

test('doctor resolves providers and rejects undefined ones without reading credentials', t => {
  const dir = fixture(t), c = legacyConfig();
  put(dir, 'config.toml', 'model_provider = "gateway"\n[model_providers.gateway]\nname = "Gateway"\n');
  assert.equal(inspectCatalog(c, dir).rows[1].provider, 'gateway');
  c.roles.coding.provider = 'missing';
  assert.match(inspectCatalog(c, dir).errors.join('\n'), /not defined/);
});

test('CLI build produces a parseable profile and CLI install defaults to preview', t => {
  const dir = fixture(t), out = path.join(dir, 'bundle'), home = path.join(dir, 'home');
  const configPath = put(dir, 'legacy-routing.toml', stringify(legacyConfig()));
  const build = spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), 'build', '--config', configPath, '--out', out], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const profile = parse(fs.readFileSync(path.join(out, 'task-routing.config.toml'), 'utf8'));
  assert.equal(profile.model, 'gpt-6-astra');
  const preview = spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), 'install', '--config', configPath, '--codex-home', home], { encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Preview only/);
  assert.equal(fs.existsSync(home), false);
});

test('activation lives only in the generated profile and follows custom profile names', t => {
  const c = legacyConfig();
  c.profile = 'team-routing';
  const files = render(c);
  const activation = activationInstructions('team-routing');
  assert.equal(files.has('team-routing.config.toml'), true);
  assert.equal(files.has('task-routing.config.toml'), false);
  assert.equal(files.has('config.toml'), false);
  assert.equal(parse(files.get('team-routing.config.toml')).developer_instructions, activation);
  for (const [relative, content] of files) {
    if (relative === 'team-routing.config.toml') continue;
    assert.equal(content.includes(activation), false, `activation leaked into ${relative}`);
  }
  const agents = files.get('AGENTS.md');
  assert.ok(agents.includes('<!-- task-router:start -->'));
  assert.ok(agents.includes('When the task-routing profile is active or the user invokes $task-routing'));
  assert.ok(agents.includes('Otherwise keep the existing workflow.'));
  const dir = fixture(t);
  applyInstall(installPlan(c, dir).changes, dir);
  assert.equal(fs.existsSync(path.join(dir, 'task-routing.config.toml')), false);
  assert.equal(parse(fs.readFileSync(path.join(dir, 'team-routing.config.toml'), 'utf8')).developer_instructions, activation);
});

test('child role contracts stay byte-identical to the source and never carry the parent activation', () => {
  const c = legacyConfig();
  const plain = render(c), composed = render(c, { baseInstructions: 'Base developer text.' });
  const activation = activationInstructions(c.profile);
  for (const role of Object.keys(ROLE_META)) {
    const relative = `agents/task-routing/${role}.toml`;
    assert.equal(plain.get(relative), composed.get(relative));
    const contract = parse(plain.get(relative)).developer_instructions;
    assert.equal(contract, fs.readFileSync(path.join(ROOT, 'roles', `${role}.md`), 'utf8'));
    assert.equal(plain.get(`skills/task-routing/references/roles/${role}.md`), contract);
    assert.equal(contract.includes(activation), false);
    assert.equal(contract.includes('Base developer text.'), false);
  }
  assert.notEqual(plain.get('task-routing.config.toml'), composed.get('task-routing.config.toml'));
});

test('install snapshots base developer instructions, preserves config.toml bytes and stays idempotent', t => {
  const dir = fixture(t), c = legacyConfig();
  const baseText = '# provider settings stay untouched\nmodel = "previous"\ndeveloper_instructions = "Keep these base instructions."\n';
  put(dir, 'config.toml', baseText);
  const first = installPlan(c, dir);
  assert.equal(first.base.text, 'Keep these base instructions.');
  assert.equal(first.changes.some(change => change.relative === 'config.toml'), false);
  applyInstall(first.changes, dir);
  assert.equal(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), baseText);
  const installed = parse(fs.readFileSync(path.join(dir, 'task-routing.config.toml'), 'utf8')).developer_instructions;
  assert.equal(installed, `Keep these base instructions.\n\n${activationInstructions(c.profile)}`);
  assert.equal(installPlan(c, dir).changes.length, 0);
  assert.equal(parse(render(c).get('task-routing.config.toml')).developer_instructions, activationInstructions(c.profile));
});

test('reinstall refreshes changed and removed base developer instructions', t => {
  const dir = fixture(t), c = legacyConfig(), profilePath = path.join(dir, 'task-routing.config.toml');
  const activation = activationInstructions(c.profile);
  const firstBase = '# keep this comment\nmodel = "previous"\ndeveloper_instructions = "First base text."\n';
  put(dir, 'config.toml', firstBase);
  applyInstall(installPlan(c, dir).changes, dir);
  assert.equal(parse(fs.readFileSync(profilePath, 'utf8')).developer_instructions, `First base text.\n\n${activation}`);
  assert.equal(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), firstBase);
  const secondBase = 'model = "previous"\ndeveloper_instructions = "Second base text."\n';
  put(dir, 'config.toml', secondBase);
  const refreshed = installPlan(c, dir);
  assert.deepEqual(refreshed.changes.map(change => change.relative).sort(), ['.task-router/manifest.json', 'task-routing.config.toml']);
  applyInstall(refreshed.changes, dir);
  const second = parse(fs.readFileSync(profilePath, 'utf8')).developer_instructions;
  assert.equal(second, `Second base text.\n\n${activation}`);
  assert.equal(second.includes('First base text.'), false);
  assert.equal(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), secondBase);
  const removedBase = 'model = "previous"\n';
  put(dir, 'config.toml', removedBase);
  applyInstall(installPlan(c, dir).changes, dir);
  assert.equal(parse(fs.readFileSync(profilePath, 'utf8')).developer_instructions, activation);
  assert.equal(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'), removedBase);
});

test('stale plans are rejected after base or managed file changes, even when nothing needs writing', t => {
  const dir = fixture(t), c = legacyConfig(), activation = activationInstructions(c.profile);
  const baseLine = 'developer_instructions = "Base text."\n';
  put(dir, 'config.toml', baseLine);
  applyInstall(installPlan(c, dir).changes, dir);
  const settled = installPlan(c, dir).changes;
  assert.equal(settled.length, 0);
  // The base config is guarded even when the plan would write nothing.
  put(dir, 'config.toml', 'developer_instructions = "Changed after planning."\n');
  assert.throws(() => applyInstall(settled, dir), /Base config changed after planning/);
  put(dir, 'config.toml', baseLine);
  const restored = installPlan(c, dir).changes;
  assert.equal(restored.length, 0);
  // A managed file edited after planning is stale even when the plan writes nothing.
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nEdited after planning.\n');
  assert.throws(() => applyInstall(restored, dir), /changed after planning/);
  applyInstall(installPlan(c, dir).changes, dir);
  assert.equal(installPlan(c, dir).changes.length, 0);
  // A plan with pending writes is rejected after a later base change and writes nothing.
  put(dir, 'config.toml', 'developer_instructions = "Next base text."\n');
  const pending = installPlan(c, dir).changes;
  assert.ok(pending.some(change => change.relative === 'task-routing.config.toml'));
  put(dir, 'config.toml', 'developer_instructions = "Changed again after planning."\n');
  assert.throws(() => applyInstall(pending, dir), /Base config changed after planning/);
  assert.equal(parse(fs.readFileSync(path.join(dir, 'task-routing.config.toml'), 'utf8')).developer_instructions, `Base text.\n\n${activation}`);
});

test('portable build never carries base developer instructions while install snapshots them', t => {
  const dir = fixture(t), out = path.join(dir, 'bundle'), home = path.join(dir, 'home');
  const configPath = put(dir, 'legacy-routing.toml', stringify(legacyConfig()));
  const baseText = 'developer_instructions = "Private base instructions."\n';
  put(home, 'config.toml', baseText);
  const build = spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), 'build', '--config', configPath, '--out', out], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const bundleProfile = parse(fs.readFileSync(path.join(out, 'task-routing.config.toml'), 'utf8'));
  assert.equal(bundleProfile.developer_instructions, activationInstructions('task-routing'));
  const install = spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), 'install', '--config', configPath, '--codex-home', home, '--apply'], { encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr);
  const installed = parse(fs.readFileSync(path.join(home, 'task-routing.config.toml'), 'utf8')).developer_instructions;
  assert.equal(installed, `Private base instructions.\n\n${activationInstructions('task-routing')}`);
  assert.equal(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), baseText);
});
