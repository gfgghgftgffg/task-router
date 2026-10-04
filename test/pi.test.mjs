import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'smol-toml';
import { ROOT, ROLE_META, loadConfig, getRoleChoices, render, applyInstall } from '../src/router.mjs';
import { PI_THINKING, PI_MARKERS, PI_MANIFEST, PI_ROLE_TOOLS, renderPi, planPiInstall, inspectPiCatalog } from '../src/pi.mjs';

function config() {
  const c = loadConfig(path.join(ROOT, 'routing.toml'));
  c.orchestrator = { model: 'fixture-parent', effort: 'medium' };
  for (const role of Object.keys(ROLE_META)) c.roles[role] = { model: `fixture-${role}`, effort: 'medium' };
  c.roles.coding.options = [
    { id: 'light', model: 'fixture-fast', effort: 'low', when: 'precise mechanical edits' },
    { model: 'fixture-deep', effort: 'high', when: 'complex behavior' },
  ];
  return c;
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-router-pi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(home, relative, content) {
  const filename = path.join(home, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
  return filename;
}
function candidatePath(choice) {
  return `agents/task-routing/${choice.role}${choice.id === 'default' ? '' : `_${choice.id}`}.md`;
}
// Generated frontmatter uses only JSON-compatible scalar strings, booleans and
// comma-separated tool names. Keep the fixture parser dependency-free.
function agent(content) {
  const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(content);
  assert.ok(match, 'frontmatter must be bounded');
  const fields = Object.fromEntries(match[1].split('\n').map(line => {
    const index = line.indexOf(':');
    const key = line.slice(0, index), raw = line.slice(index + 1).trim();
    let value = raw;
    if (raw.startsWith('"') || raw === 'true' || raw === 'false') value = JSON.parse(raw);
    return [key, value];
  }));
  return { ...fields, body: match[2] };
}
function catalog(c, provider = 'relay') {
  const choices = [c.orchestrator, ...getRoleChoices(c)];
  return { models: choices.map(choice => ({ provider: choice.provider ?? provider, id: choice.model, thinkingLevels: [...PI_THINKING] })) };
}

// All tests use disposable directories and local fixtures, never live agents,
// credentials, model APIs or the operator's Pi settings.
test('Pi renders every original candidate with its own unchanged contract', () => {
  const c = config(), files = renderPi(c), choices = getRoleChoices(c);
  assert.equal([...files.keys()].filter(name => name.startsWith('agents/')).length, choices.length);
  assert.equal([...files.keys()].some(name => name.endsWith('.toml')), false);
  assert.equal(files.has('settings.json'), false);
  for (const choice of choices) {
    const parsed = agent(files.get(candidatePath(choice)));
    assert.equal(parsed.name, choice.nativeRole);
    assert.equal(parsed.model, choice.model);
    assert.equal(parsed.thinking, choice.effort);
    assert.equal(parsed.body, fs.readFileSync(path.join(ROOT, 'roles', `${choice.role}.md`), 'utf8'));
    assert.equal(parsed.tools, PI_ROLE_TOOLS[choice.role].join(', '));
    assert.equal(parsed.async, true);
    assert.equal(parsed.defaultContext, 'fresh');
    assert.equal(parsed.inheritSkills, false);
    assert.equal(parsed.inheritProjectContext, true);
    assert.equal(parsed.inheritGlobalContext, true);
    assert.equal(parsed.acceptanceRole, undefined, 'must not infer Pi builtin reviewer routing');
    assert.equal(parsed.tools.split(', ').includes('subagent'), false);
    assert.ok(files.get('skills/task-routing/references/role-map.md').includes(choice.nativeRole));
  }
  assert.match(files.get('skills/task-routing/SKILL.md'), /disable-model-invocation: true/);
});

test('Pi preserves per-candidate provider inheritance', () => {
  const c = config();
  c.orchestrator.provider = 'parent-provider';
  c.roles.coding.provider = 'coder-provider';
  c.roles.coding.options[1].provider = 'deep-provider';
  const choices = getRoleChoices(c).filter(choice => choice.role === 'coding');
  const files = renderPi(c);
  assert.equal(agent(files.get(candidatePath(choices[0]))).model, 'coder-provider/fixture-coding');
  assert.equal(agent(files.get(candidatePath(choices[1]))).model, 'fixture-fast');
  assert.equal(agent(files.get(candidatePath(choices[2]))).model, 'deep-provider/fixture-deep');
  assert.match(files.get('skills/task-routing/references/role-map.md'), /active parent provider, not the provider on another candidate/);
});

test('Pi rejects provider-specific labels without changing the Codex renderer', () => {
  const c = config();
  c.roles.coding.options[0].effort = 'adaptive';
  assert.throws(() => renderPi(c), /Pi does not support effort 'adaptive'/);
  assert.ok(render(c).get('agents/task-routing/coding_light.toml').includes('adaptive'));
  c.roles.coding.options[0].effort = 'low';
  c.orchestrator.effort = 'ultra';
  assert.throws(() => renderPi(c), /orchestrator: Pi does not support effort 'ultra'/);
});

test('Pi role tools preserve explicit mutation boundaries and local skill references', () => {
  for (const role of ['search', 'reasoning']) {
    for (const tool of ['bash', 'edit', 'write']) assert.equal(PI_ROLE_TOOLS[role].includes(tool), false);
  }
  assert.ok(PI_ROLE_TOOLS.verify.includes('bash'));
  assert.equal(PI_ROLE_TOOLS.verify.includes('edit'), false);
  assert.equal(PI_ROLE_TOOLS.verify.includes('write'), false);
  for (const tool of ['web_search', 'fetch_content', 'get_search_content', 'source_check']) assert.ok(PI_ROLE_TOOLS.search.includes(tool));
  const files = renderPi(config());
  for (const [relative, content] of files) {
    if (!relative.endsWith('.md')) continue;
    for (const match of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
      assert.ok(files.has(target), `${relative} references missing ${target}`);
    }
  }
});

test('Pi preview and install preserve settings, builtins and Codex markers/manifest', t => {
  const home = fixture(t);
  const settings = '{"defaultProvider":"relay","packages":["npm:pi-subagents"],"subagents":{"agentOverrides":{"worker":{"thinking":"high"}}}}\n';
  const instructions = 'Original instructions.\n<!-- codex-task-router:start -->\nCodex block.\n<!-- codex-task-router:end -->\n';
  const builtin = 'Do not replace the worker.\n';
  put(home, 'settings.json', settings);
  put(home, 'AGENTS.md', instructions);
  put(home, 'agents/worker.md', builtin);
  put(home, '.task-router/manifest.json', '{"version":1,"files":{}}\n');
  const files = renderPi(config()), changes = planPiInstall(files, home);
  assert.equal(fs.existsSync(path.join(home, PI_MANIFEST)), false);
  assert.equal(changes.some(change => change.relative === 'settings.json'), false);
  applyInstall(changes, home);
  assert.equal(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'), settings);
  assert.equal(fs.readFileSync(path.join(home, 'agents/worker.md'), 'utf8'), builtin);
  assert.equal(fs.readFileSync(path.join(home, '.task-router/manifest.json'), 'utf8'), '{"version":1,"files":{}}\n');
  const actual = fs.readFileSync(path.join(home, 'AGENTS.md'), 'utf8');
  assert.ok(actual.startsWith(instructions));
  assert.ok(actual.includes(PI_MARKERS.start));
  assert.equal(planPiInstall(files, home).length, 0);
});

test('Pi settings and managed files guard even an empty install plan', t => {
  const home = fixture(t), files = renderPi(config());
  put(home, 'settings.json', '{}\n');
  applyInstall(planPiInstall(files, home), home);
  const empty = planPiInstall(files, home);
  assert.equal(empty.length, 0);
  put(home, 'settings.json', '{"defaultProvider":"changed"}\n');
  assert.throws(() => applyInstall(empty, home), /Base config changed after planning/);
  const next = planPiInstall(files, home);
  fs.appendFileSync(path.join(home, 'agents/task-routing/coding.md'), '\nmanual edit\n');
  assert.throws(() => applyInstall(next, home), /changed after planning/);
  assert.throws(() => planPiInstall(files, home), /unowned or edited/);
});

test('Pi refuses unowned roles, broken markers and redirected managed paths', t => {
  const home = fixture(t), files = renderPi(config());
  put(home, 'agents/task-routing/coding.md', 'Existing custom agent.\n');
  assert.throws(() => planPiInstall(files, home), /unowned or edited/);
  const markers = fixture(t);
  put(markers, 'AGENTS.md', PI_MARKERS.start);
  assert.throws(() => planPiInstall(files, markers), /ambiguous/);
  const linked = fixture(t), other = fixture(t);
  fs.symlinkSync(other, path.join(linked, 'agents'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => planPiInstall(files, linked), /symlink\/junction/);
  assert.deepEqual(fs.readdirSync(other), []);
});

test('Pi candidate removal is backed up, idempotent and refuses edited candidates', t => {
  const c = config(), home = fixture(t);
  applyInstall(planPiInstall(renderPi(c), home), home);
  const relative = 'agents/task-routing/coding_light.md';
  const previous = fs.readFileSync(path.join(home, relative), 'utf8');
  c.roles.coding.options.shift();
  const changes = planPiInstall(renderPi(c), home);
  assert.equal(changes.find(change => change.relative === relative).content, undefined);
  const result = applyInstall(changes, home);
  assert.equal(fs.existsSync(path.join(home, relative)), false);
  assert.equal(fs.readFileSync(path.join(result.backup, relative), 'utf8'), previous);
  assert.equal(planPiInstall(renderPi(c), home).length, 0);
  const edited = fixture(t), before = config();
  applyInstall(planPiInstall(renderPi(before), edited), edited);
  fs.appendFileSync(path.join(edited, relative), '\nmanual change\n');
  before.roles.coding.options.shift();
  assert.throws(() => planPiInstall(renderPi(before), edited), /Preserving edited candidate file/);
});

test('Pi doctor checks exact provider/model and every candidate thinking level', t => {
  const home = fixture(t), c = config();
  put(home, 'settings.json', '{"defaultProvider":"relay"}\n');
  const snapshot = catalog(c);
  const filename = put(home, 'catalog.json', JSON.stringify(snapshot));
  assert.deepEqual(inspectPiCatalog(c, home, filename).errors, []);
  snapshot.models.find(model => model.id === 'fixture-fast').thinkingLevels = ['high'];
  put(home, 'catalog.json', JSON.stringify(snapshot));
  assert.match(inspectPiCatalog(c, home, filename).errors.join('\n'), /coding:light: thinking 'low' is unsupported/);
  c.roles.search.provider = 'missing-provider';
  assert.match(inspectPiCatalog(c, home, filename).errors.join('\n'), /missing-provider\/fixture-search.*absent/);
});

test('Pi doctor respects the configured child thinking ceiling without capping the parent', t => {
  const home = fixture(t), c = config();
  c.orchestrator.effort = 'max';
  put(home, 'settings.json', '{"subagents":{"maxThinking":"medium"}}\n');
  const report = inspectPiCatalog(c, home);
  assert.match(report.errors.join('\n'), /coding:auto_.*exceeds Pi subagents.maxThinking 'medium'/);
  assert.equal(report.errors.some(error => error.startsWith('orchestrator:')), false);
  put(home, 'settings.json', '{"subagents":{"maxThinking":"unsupported"}}\n');
  assert.throws(() => inspectPiCatalog(c, home), /maxThinking must be a supported thinking level/);
});

test('Pi doctor reports ambiguity, unknown thinking and absent snapshots honestly', t => {
  const home = fixture(t), c = config();
  const snapshot = catalog(c);
  snapshot.models.push({ provider: 'other', id: 'fixture-parent', thinkingLevels: ['medium'] });
  delete snapshot.models.find(model => model.id === 'fixture-fast').thinkingLevels;
  const filename = put(home, 'catalog.json', JSON.stringify(snapshot));
  const report = inspectPiCatalog(c, home, filename);
  assert.match(report.errors.join('\n'), /multiple providers/);
  assert.match(report.warnings.join('\n'), /snapshot does not advertise thinkingLevels/);
  const absent = inspectPiCatalog(c, home);
  assert.deepEqual(absent.errors, []);
  assert.match(absent.warnings.join('\n'), /No Pi registry snapshot/);
  assert.match(absent.warnings.join('\n'), /do not reproduce Codex OS sandboxes/);
});

test('Pi doctor refuses malformed or duplicate registry entries', t => {
  const home = fixture(t), c = config();
  const bad = put(home, 'bad.json', '{"models":[{"slug":"Codex-format"}]}');
  assert.throws(() => inspectPiCatalog(c, home, bad), /require valid provider and id/);
  const snapshot = catalog(c);
  snapshot.models.push(snapshot.models[0]);
  put(home, 'bad.json', JSON.stringify(snapshot));
  assert.throws(() => inspectPiCatalog(c, home, bad), /duplicate model/);
  put(home, 'settings.json', '{');
  assert.throws(() => inspectPiCatalog(c, home), /Cannot parse Pi settings/);
});

test('CLI Pi build is isolated, install defaults to preview and host flags are checked', t => {
  const root = fixture(t), home = path.join(root, 'home'), out = path.join(root, 'bundle');
  const filename = put(root, 'routing.toml', stringify(config()));
  const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), ...args], { encoding: 'utf8' });
  const build = cli('build', '--host', 'pi', '--config', filename, '--out', out);
  assert.equal(build.status, 0, build.stderr);
  assert.ok(fs.existsSync(path.join(out, 'agents/task-routing/coding.md')));
  assert.equal(fs.existsSync(path.join(out, 'task-routing.config.toml')), false);
  const preview = cli('install', '--host', 'pi', '--config', filename, '--pi-home', home);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Preview only/);
  assert.equal(fs.existsSync(home), false);
  const applied = cli('install', '--host', 'pi', '--config', filename, '--pi-home', home, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Installation does not activate routing/);
  assert.equal(cli('doctor', '--host', 'unknown').status, 1);
  assert.equal(cli('install', '--host', 'pi', '--codex-home', home).status, 1);
  assert.equal(cli('install', '--pi-home', home).status, 1);
  assert.equal(cli('build', '--host', 'pi', '--pi-home', home, '--out', home).status, 1);
});
