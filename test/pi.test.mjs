import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'smol-toml';
import { ROOT, ROLE_META, loadConfig, getRoleChoices, render, applyInstall } from '../src/router.mjs';
import { PI_THINKING, PI_MARKERS, PI_MANIFEST, PI_ROLE_TOOLS, PI_DENIED_TOOLS, renderPi, planPiInstall, inspectPiCatalog, readPiRuntimeSettings } from '../src/pi.mjs';

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
const candidatePath = choice => `agents/${choice.nativeRole}.md`;
function agent(content) {
  const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(content);
  assert.ok(match, 'frontmatter must be bounded');
  const fields = Object.fromEntries(match[1].split('\n').map(line => {
    const index = line.indexOf(':'), key = line.slice(0, index), raw = line.slice(index + 1).trim();
    return [key, raw.startsWith('"') || raw === 'true' || raw === 'false' ? JSON.parse(raw) : raw];
  }));
  return { ...fields, body: match[2] };
}
function catalog(c, provider = 'relay') {
  return { models: [c.orchestrator, ...getRoleChoices(c)].map(choice => ({ provider: choice.provider ?? provider, id: choice.model, thinkingLevels: [...PI_THINKING] })) };
}
function legacyFiles(c) {
  const files = renderPi(c);
  for (const choice of getRoleChoices(c)) {
    const content = files.get(candidatePath(choice));
    files.delete(candidatePath(choice));
    files.set(`agents/task-routing/${choice.role}${choice.id === 'default' ? '' : `_${choice.id}`}.md`, content.replace('prompt_mode: replace', 'systemPromptMode: replace'));
  }
  return files;
}

// Disposable directories/local fixtures only: no operator config, credentials,
// extension loads, remote model APIs or live agents are used by npm test.
test('Pi renders flat lean candidates with unchanged contracts and no model pins', () => {
  const c = config(), files = renderPi(c), choices = getRoleChoices(c);
  assert.equal([...files.keys()].filter(name => name.startsWith('agents/')).length, choices.length);
  assert.equal([...files.keys()].some(name => name.endsWith('.toml')), false);
  assert.equal(files.has('settings.json'), false);
  assert.equal(files.has('subagents.json'), false);
  for (const choice of choices) {
    const parsed = agent(files.get(candidatePath(choice)));
    assert.equal(candidatePath(choice).split('/').length, 2, 'tintinweb scans no nested directories');
    assert.equal(parsed.name, choice.nativeRole);
    assert.equal(parsed.model, undefined, 'pins would defeat direct-call user overrides and provider inheritance');
    assert.equal(parsed.thinking, undefined);
    assert.equal(parsed.body, fs.readFileSync(path.join(ROOT, 'roles', `${choice.role}.md`), 'utf8'));
    assert.equal(parsed.tools, PI_ROLE_TOOLS[choice.role].join(', '));
    assert.equal(parsed.disallowed_tools, PI_DENIED_TOOLS.join(', '));
    assert.equal(parsed.prompt_mode, 'replace');
    assert.equal(parsed.inherit_context, false);
    assert.equal(parsed.run_in_background, true);
    assert.equal(parsed.skills, false);
    assert.equal(parsed.extensions, true, 'preserve permission/provider extension hooks');
    assert.equal(parsed.allowed_subagents, 'none');
    for (const key of ['systemPromptMode', 'defaultContext', 'async', 'inheritSkills', 'inheritProjectContext', 'inheritGlobalContext', 'acceptanceRole']) assert.equal(parsed[key], undefined);
    assert.ok(files.get('skills/task-routing/references/role-map.md').includes(choice.nativeRole));
  }
  assert.match(files.get('skills/task-routing/SKILL.md'), /disable-model-invocation: true/);
});

test('Pi role map retains per-candidate routes and active-provider inheritance', () => {
  const c = config();
  c.orchestrator.provider = 'parent-provider';
  c.roles.coding.provider = 'coder-provider';
  c.roles.coding.options[1].provider = 'deep-provider';
  const map = renderPi(c).get('skills/task-routing/references/role-map.md');
  assert.match(map, /fixture-coding \| medium \| coder-provider/);
  assert.match(map, /fixture-fast \| low \| active parent provider/);
  assert.match(map, /fixture-deep \| high \| deep-provider/);
  assert.match(map, /active parent provider, not the provider on another candidate/);
  assert.match(map, /Always supply both/);
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

test('Pi closes extension tool exposure while keeping role mutation boundaries', () => {
  for (const role of ['search', 'reasoning']) for (const tool of ['bash', 'edit', 'write']) assert.equal(PI_ROLE_TOOLS[role].includes(tool), false);
  assert.ok(PI_ROLE_TOOLS.verify.includes('bash'));
  for (const tool of ['edit', 'write']) assert.equal(PI_ROLE_TOOLS.verify.includes(tool), false);
  for (const tools of Object.values(PI_ROLE_TOOLS)) {
    assert.ok(tools.includes('ext:pi-subagents-lean/subagent'), 'every role must opt into CLOSED extension-tool scope');
    assert.equal(tools.includes('contact_supervisor'), false);
  }
  assert.ok(PI_DENIED_TOOLS.includes('subagent'));
  assert.ok(PI_ROLE_TOOLS.search.includes('ext:pi-web-access-lean/web_access'));
  assert.equal(PI_ROLE_TOOLS.search.includes('web_search'), false);
  const files = renderPi(config());
  for (const [relative, content] of files) {
    if (!relative.endsWith('.md')) continue;
    for (const match of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
      assert.ok(files.has(target), `${relative} references missing ${target}`);
    }
  }
});

test('Pi lean skill documents distinct direct/workflow fields and known engine limits', () => {
  const files = renderPi(config()), skill = files.get('skills/task-routing/SKILL.md'), execution = files.get('skills/task-routing/references/pi-execution.md');
  assert.match(skill, /op: "run"/);
  assert.match(skill, /subagent_type: "tr_coding"/);
  assert.match(skill, /JSON.stringify\(\{ model: "provider\/exact-id", thinking: "high" \}\)/);
  assert.match(skill, /frontmatter/);
  assert.match(skill, /does NOT inherit AGENTS.md/);
  assert.match(execution, /op: "workflow"/);
  assert.match(execution, /agentType: "tr_\.\.\."/);
  assert.match(execution, /effort: "high"/);
  assert.match(execution, /max\(1, min\(16, cpus - 2\)\)/);
  assert.match(execution, /bounded chunks/);
  assert.match(execution, /returns `null`/);
  assert.match(execution, /can silently drop/);
});

test('Pi preview/install preserve settings, runtime settings, other roles and Codex state', t => {
  const home = fixture(t);
  const settings = '{"defaultProvider":"relay","packages":["npm:@ssk_dev/pi-subagents-lean"]}\n';
  const tuning = '{"maxConcurrent":3,"fallbackSubagent":"none"}\n';
  const instructions = 'Original instructions.\n<!-- task-router:start -->\nCodex block.\n<!-- task-router:end -->\n';
  put(home, 'settings.json', settings); put(home, 'subagents.json', tuning);
  put(home, 'AGENTS.md', instructions); put(home, 'agents/worker.md', 'Do not replace the worker.\n');
  put(home, '.task-router/manifest.json', '{"version":1,"files":{}}\n');
  const files = renderPi(config()), changes = planPiInstall(files, home);
  assert.equal(fs.existsSync(path.join(home, PI_MANIFEST)), false);
  assert.equal(changes.some(change => ['settings.json', 'subagents.json'].includes(change.relative)), false);
  applyInstall(changes, home);
  assert.equal(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'), settings);
  assert.equal(fs.readFileSync(path.join(home, 'subagents.json'), 'utf8'), tuning);
  assert.equal(fs.readFileSync(path.join(home, 'agents/worker.md'), 'utf8'), 'Do not replace the worker.\n');
  assert.equal(fs.readFileSync(path.join(home, '.task-router/manifest.json'), 'utf8'), '{"version":1,"files":{}}\n');
  const actual = fs.readFileSync(path.join(home, 'AGENTS.md'), 'utf8');
  assert.ok(actual.startsWith(instructions)); assert.ok(actual.includes(PI_MARKERS.start));
  assert.equal(planPiInstall(files, home).length, 0);
});

test('Pi settings and managed files guard even an empty install plan', t => {
  const home = fixture(t), files = renderPi(config());
  put(home, 'settings.json', '{}\n'); applyInstall(planPiInstall(files, home), home);
  const empty = planPiInstall(files, home); assert.equal(empty.length, 0);
  put(home, 'settings.json', '{"defaultProvider":"changed"}\n');
  assert.throws(() => applyInstall(empty, home), /Base config changed after planning/);
  const next = planPiInstall(files, home);
  fs.appendFileSync(path.join(home, 'agents/tr_coding.md'), '\nmanual edit\n');
  assert.throws(() => applyInstall(next, home), /changed after planning/);
  assert.throws(() => planPiInstall(files, home), /unowned or edited/);
});

test('Pi runtime tuning changes invalidate an empty install plan including project overrides', t => {
  const home = fixture(t), cwd = fixture(t), files = renderPi(config());
  applyInstall(planPiInstall(files, home, { cwd }), home);
  const plan = planPiInstall(files, home, { cwd });
  put(cwd, '.pi/subagents.json', '{"workflowsEnabled":false}');
  assert.throws(() => applyInstall(plan, home), /Pi subagents settings changed after planning/);
  const next = planPiInstall(files, home, { cwd });
  put(home, 'subagents.json', '{"fallbackSubagent":"none"}');
  assert.throws(() => applyInstall(next, home), /Pi subagents settings changed after planning/);
});

test('Pi refuses unowned roles, broken markers and redirected managed paths', t => {
  const home = fixture(t), files = renderPi(config()); put(home, 'agents/tr_coding.md', 'Custom agent.\n');
  assert.throws(() => planPiInstall(files, home), /unowned or edited/);
  const markers = fixture(t); put(markers, 'AGENTS.md', PI_MARKERS.start);
  assert.throws(() => planPiInstall(files, markers), /ambiguous/);
  const linked = fixture(t), other = fixture(t);
  fs.symlinkSync(other, path.join(linked, 'agents'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => planPiInstall(files, linked), /symlink\/junction/); assert.deepEqual(fs.readdirSync(other), []);
});

test('Pi candidate removal is backed up/idempotent and refuses edited candidates', t => {
  const c = config(), home = fixture(t); applyInstall(planPiInstall(renderPi(c), home), home);
  const relative = 'agents/tr_coding_light.md', previous = fs.readFileSync(path.join(home, relative), 'utf8');
  c.roles.coding.options.shift(); const changes = planPiInstall(renderPi(c), home);
  assert.equal(changes.find(change => change.relative === relative).content, undefined);
  const result = applyInstall(changes, home); assert.equal(fs.existsSync(path.join(home, relative)), false);
  assert.equal(fs.readFileSync(path.join(result.backup, relative), 'utf8'), previous);
  assert.equal(planPiInstall(renderPi(c), home).length, 0);
  const edited = fixture(t), before = config(); applyInstall(planPiInstall(renderPi(before), edited), edited);
  fs.appendFileSync(path.join(edited, relative), '\nmanual change\n'); before.roles.coding.options.shift();
  assert.throws(() => planPiInstall(renderPi(before), edited), /Preserving edited candidate file/);
});

test('Pi migrates all legacy nested base/candidate files using manifest hashes', t => {
  const c = config(), home = fixture(t), old = legacyFiles(c);
  applyInstall(planPiInstall(old, home), home);
  put(home, 'agents/task-routing/unowned.md', 'Keep unrelated nested agent');
  const changes = planPiInstall(renderPi(c), home), result = applyInstall(changes, home);
  for (const [relative, content] of old) {
    if (!relative.startsWith('agents/')) continue;
    assert.equal(fs.existsSync(path.join(home, relative)), false);
    assert.equal(fs.readFileSync(path.join(result.backup, relative), 'utf8'), content);
  }
  for (const choice of getRoleChoices(c)) assert.ok(fs.existsSync(path.join(home, candidatePath(choice))));
  assert.equal(fs.readFileSync(path.join(home, 'agents/task-routing/unowned.md'), 'utf8'), 'Keep unrelated nested agent');
  assert.equal(planPiInstall(renderPi(c), home).length, 0);
});

test('Pi migration refuses edited old bases and collisions before writing anything', t => {
  for (const edited of [false, true]) {
    const c = config(), home = fixture(t); applyInstall(planPiInstall(legacyFiles(c), home), home);
    if (edited) fs.appendFileSync(path.join(home, 'agents/task-routing/coding.md'), '\nuser edit');
    else put(home, 'agents/tr_coding.md', 'User-owned flat role');
    assert.throws(() => planPiInstall(renderPi(c), home), /Preserving (edited candidate|unowned or edited) file/);
    assert.ok(fs.existsSync(path.join(home, 'agents/task-routing/search.md')));
    assert.equal(fs.existsSync(path.join(home, 'agents/tr_search.md')), false);
  }
});

test('Pi migration rejects unknown previously managed deletion paths', t => {
  const c = config(), home = fixture(t), old = legacyFiles(c);
  old.set('agents/task-routing/not-router.md', 'Unrecognized managed role'); applyInstall(planPiInstall(old, home), home);
  assert.throws(() => planPiInstall(renderPi(c), home), /Previously managed path would become stale/);
});

test('Pi doctor checks exact provider/model and every candidate thinking level', t => {
  const home = fixture(t), c = config(); put(home, 'settings.json', '{"defaultProvider":"relay"}\n');
  const snapshot = catalog(c), filename = put(home, 'catalog.json', JSON.stringify(snapshot));
  assert.deepEqual(inspectPiCatalog(c, home, filename).errors, []);
  snapshot.models.find(model => model.id === 'fixture-fast').thinkingLevels = ['high']; put(home, 'catalog.json', JSON.stringify(snapshot));
  assert.match(inspectPiCatalog(c, home, filename).errors.join('\n'), /coding:light: thinking 'low' is unsupported/);
  c.roles.search.provider = 'missing-provider';
  assert.match(inspectPiCatalog(c, home, filename).errors.join('\n'), /missing-provider\/fixture-search.*absent/);
});

test('Pi doctor uses observed active provider for unqualified children, not recommended parent', t => {
  const home = fixture(t), c = config(); c.orchestrator.provider = 'recommended'; c.roles.search.provider = 'explicit';
  const snapshot = catalog(c, 'active'); snapshot.activeProvider = 'active';
  const filename = put(home, 'catalog.json', JSON.stringify(snapshot)), report = inspectPiCatalog(c, home, filename);
  assert.deepEqual(report.errors, []);
  assert.equal(report.rows.find(row => row.role === 'orchestrator').provider, 'recommended');
  assert.equal(report.rows.find(row => row.role === 'coding').provider, 'active');
  assert.equal(report.rows.find(row => row.role === 'search').provider, 'explicit');
});

test('Pi doctor uses lean tuning and flags legacy nicobailon settings as ignored', t => {
  const home = fixture(t), cwd = fixture(t), c = config(); c.orchestrator.effort = 'max';
  put(home, 'settings.json', '{"subagents":{"maxThinking":"unsupported","agentOverrides":{}}}');
  let report = inspectPiCatalog(c, home, undefined, { cwd }); assert.deepEqual(report.errors, []);
  assert.match(report.warnings.join('\n'), /Legacy maxThinking\/agentOverrides do not enforce routes/);
  assert.match(report.warnings.join('\n'), /fallbackSubagent/);
  put(home, 'subagents.json', '{"fallbackSubagent":"none","strictAgentFiles":true,"workflowsEnabled":true}');
  report = inspectPiCatalog(c, home, undefined, { cwd });
  assert.equal(report.warnings.some(w => w.startsWith('Set fallbackSubagent') || w.startsWith('Set strictAgentFiles')), false);
  put(cwd, '.pi/subagents.json', '{"workflowsEnabled":false,"worktreeIsolation":false}');
  report = inspectPiCatalog(c, home, undefined, { cwd });
  assert.deepEqual(report.errors, []);
  assert.match(report.warnings.join('\n'), /workflowsEnabled is false.*direct coordination remains available/);
  assert.match(report.warnings.join('\n'), /silently drop requested isolation/);
});

test('Pi doctor reports direct-only off routes instead of claiming workflow support', t => {
  const c = config(), home = fixture(t);
  c.roles.coding.options[0].effort = 'off';
  assert.ok(renderPi(c).has('agents/tr_coding_light.md'));
  const report = inspectPiCatalog(c, home);
  assert.deepEqual(report.errors, []);
  assert.match(report.warnings.join('\n'), /coding:light: thinking off is supported by direct lean runs, but native workflow agent\(\) effort rejects off/);
});

test('Pi runtime settings merge project over global and refuse malformed JSON', t => {
  const home = fixture(t), cwd = fixture(t);
  put(home, 'subagents.json', '{"maxConcurrent":3,"strictAgentFiles":true}');
  put(cwd, '.pi/subagents.json', '{"maxConcurrent":1}');
  assert.deepEqual(readPiRuntimeSettings(home, cwd).settings, { maxConcurrent: 1, strictAgentFiles: true });
  put(cwd, '.pi/subagents.json', '{'); assert.throws(() => readPiRuntimeSettings(home, cwd), /Cannot parse Pi subagents settings/);
});

test('Pi doctor reports ambiguity, unknown thinking and absent snapshots honestly', t => {
  const home = fixture(t), c = config(), snapshot = catalog(c);
  snapshot.models.push({ provider: 'other', id: 'fixture-parent', thinkingLevels: ['medium'] });
  delete snapshot.models.find(model => model.id === 'fixture-fast').thinkingLevels;
  const filename = put(home, 'catalog.json', JSON.stringify(snapshot)), report = inspectPiCatalog(c, home, filename);
  assert.match(report.errors.join('\n'), /multiple providers/); assert.match(report.warnings.join('\n'), /snapshot does not advertise thinkingLevels/);
  const absent = inspectPiCatalog(c, home); assert.deepEqual(absent.errors, []);
  assert.match(absent.warnings.join('\n'), /No Pi registry snapshot/); assert.match(absent.warnings.join('\n'), /do not reproduce Codex OS sandboxes/);
});

test('Pi doctor refuses malformed/duplicate registry entries and activeProvider', t => {
  const home = fixture(t), c = config(), bad = put(home, 'bad.json', '{"models":[{"slug":"Codex-format"}]}');
  assert.throws(() => inspectPiCatalog(c, home, bad), /require valid provider and id/);
  const snapshot = catalog(c); snapshot.models.push(snapshot.models[0]); put(home, 'bad.json', JSON.stringify(snapshot));
  assert.throws(() => inspectPiCatalog(c, home, bad), /duplicate model/);
  snapshot.models.pop(); snapshot.activeProvider = '/invalid'; put(home, 'bad.json', JSON.stringify(snapshot));
  assert.throws(() => inspectPiCatalog(c, home, bad), /activeProvider must be a valid provider/);
  put(home, 'settings.json', '{'); assert.throws(() => inspectPiCatalog(c, home), /Cannot parse Pi settings/);
});

test('CLI Pi build is isolated, install previews and host flags are checked', t => {
  const root = fixture(t), home = path.join(root, 'home'), out = path.join(root, 'bundle'), filename = put(root, 'routing.toml', stringify(config()));
  const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), ...args], { encoding: 'utf8' });
  const build = cli('build', '--host', 'pi', '--config', filename, '--out', out); assert.equal(build.status, 0, build.stderr);
  assert.ok(fs.existsSync(path.join(out, 'agents/tr_coding.md'))); assert.equal(fs.existsSync(path.join(out, 'task-routing.config.toml')), false);
  const preview = cli('install', '--host', 'pi', '--config', filename, '--pi-home', home); assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Preview only/); assert.equal(fs.existsSync(home), false);
  const applied = cli('install', '--host', 'pi', '--config', filename, '--pi-home', home, '--apply'); assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Installation does not activate routing/); assert.match(applied.stdout, /@ssk_dev\/pi-subagents-lean/);
  assert.equal(cli('doctor', '--host', 'unknown').status, 1); assert.equal(cli('install', '--host', 'pi', '--codex-home', home).status, 1);
  assert.equal(cli('install', '--pi-home', home).status, 1); assert.equal(cli('build', '--host', 'pi', '--pi-home', home, '--out', home).status, 1);
});
