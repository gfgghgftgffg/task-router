import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadConfig, applyInstall } from '../src/router.mjs';
import { PI_RUNTIME, PI_WEB_RUNTIME, PI_RUNTIME_REPOSITORY, PI_RUNTIME_BASELINE, PI_ROLE_TOOLS, renderPi, planPiInstall, inspectPiCatalog } from '../src/pi.mjs';

const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const config = () => loadConfig(path.join(ROOT, 'routing.toml'));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-router-amox-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(home, relative, content) {
  const target = path.join(home, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('Pi runtime identity and reviewed baseline point to the amox repository', () => {
  assert.equal(PI_RUNTIME, '@gfgghgftgffg/pi-subagents-lean');
  assert.equal(PI_WEB_RUNTIME, '@gfgghgftgffg/pi-web-access-lean');
  assert.equal(PI_RUNTIME_REPOSITORY, 'https://github.com/gfgghgftgffg/amox_pi_extensions_lean');
  assert.deepEqual(PI_RUNTIME_BASELINE, { tag: 'v0.1.2', engine: '0.22.0', minimumPi: '1.1.0' });
  assert.ok(Object.isFrozen(PI_RUNTIME_BASELINE));
  const files = renderPi(config()), map = files.get('skills/task-routing/references/role-map.md');
  for (const text of [PI_RUNTIME, PI_RUNTIME_REPOSITORY, 'v0.1.2', '0.22.0', 'Pi >=1.1.0']) assert.ok(map.includes(text));
  assert.ok(files.get('AGENTS.md').includes(`Use ${PI_RUNTIME} from amox_pi_extensions_lean`));
  for (const relative of ['AGENTS.md', 'skills/task-routing/SKILL.md', 'skills/task-routing/references/pi-execution.md', 'skills/task-routing/references/role-map.md']) assert.doesNotMatch(files.get(relative), /@ssk_dev\/|upstream 0\.19\.0/);
});

test('installation docs use independent repository scripts, not unpublished npm or workspace-root installs', () => {
  for (const relative of ['README.md', 'docs/pi.md']) {
    const text = read(relative);
    assert.ok(text.includes(PI_RUNTIME_REPOSITORY));
    assert.match(text, /scripts\/install-extension\.mjs pi-subagents-lean/);
    assert.match(text, /scripts\/install-extension\.mjs pi-web-access-lean/);
    assert.match(text, /不发布 npm 包/);
    assert.match(text, /Pi >=1\.1\.0/);
    assert.doesNotMatch(text, /pi install npm:@(?:ssk_dev|gfgghgftgffg)\/pi-(?:subagents|web-access)-lean/);
  }
  assert.match(read('docs/pi.md'), /pi remove npm:@ssk_dev\/pi-subagents-lean@0\.19\.4/);
  assert.match(read('docs/pi.md'), /保留 provider、权限插件和其他扩展/);
  assert.match(read('docs/pi.md'), /0\.19\.4 \/ 0\.19\.0 旧后端/);
  const deps = JSON.parse(read('package.json')).dependencies;
  assert.deepEqual(Object.keys(deps), ['smol-toml'], 'host runtime must not enter the static Router dependency tree');
});

test('scoped amox packages keep unscoped ext selectors and the original role hooks/tools', () => {
  for (const tools of Object.values(PI_ROLE_TOOLS)) {
    assert.ok(tools.includes('ext:pi-subagents-lean/subagent'));
    assert.ok(tools.every(tool => !tool.startsWith('ext:@')));
    for (const forbidden of ['codemode', 'tool_search', 'mcp__write']) assert.equal(tools.includes(forbidden), false);
  }
  assert.ok(PI_ROLE_TOOLS.search.includes('ext:pi-web-access-lean/web_access'));
  for (const [relative, text] of renderPi(config())) {
    if (!relative.startsWith('agents/')) continue;
    assert.match(text, /^extensions: true$/m);
    assert.match(text, /^skills: false$/m);
    assert.match(text, /^allowed_subagents: none$/m);
    assert.doesNotMatch(text, /^(?:model|thinking|isolated|isolation|exclude_extensions):/m);
  }
});

test('policy covers package discovery, trust, isolated precedence and nested/deferred tool scope', () => {
  const files = renderPi(config());
  for (const relative of ['skills/task-routing/SKILL.md', 'skills/task-routing/references/pi-execution.md', 'skills/task-routing/references/role-map.md']) {
    const text = files.get(relative);
    for (const token of ['packageAgents/packageWorkflows', 'trust', 'isolated', 'codemode', 'tool_search', 'MCP', 'ctx.executeTool']) assert.ok(text.includes(token), `${relative} must address ${token}`);
  }
  const execution = files.get('skills/task-routing/references/pi-execution.md');
  assert.match(execution, /strictAgentFiles does not make malformed package files fatal/);
  assert.match(execution, /worktree.*controlled by the script's isolation option/);
  assert.match(execution, /not a worktree or OS sandbox/);
  assert.match(execution, /late registration, tool_search activation and nested ctx.executeTool/);
  assert.match(execution, /do not assume a hidden declaration means a tool cannot be invoked/);
});

test('partial completion notifications preserve batch ownership and do not imply all writers stopped', () => {
  const files = renderPi(config());
  for (const relative of ['skills/task-routing/SKILL.md', 'skills/task-routing/references/pi-execution.md', 'skills/task-routing/references/role-map.md']) {
    const text = files.get(relative);
    assert.match(text, /[Ss]mart\/async/);
    assert.match(text, /outstanding child/);
    assert.match(text, /writer/);
  }
  const execution = files.get('skills/task-routing/references/pi-execution.md');
  assert.match(execution, /do not change it silently/);
  assert.match(execution, /reading a completed direct result before its notification is delivered suppresses that notification/);
  assert.match(execution, /do not use an early result read as polling/);
});

test('doctor warns about legacy string/object sources without editing settings or claiming runtime verification', t => {
  const home = fixture(t), cwd = fixture(t);
  const settings = JSON.stringify({ defaultProvider: 'keep-provider', packages: [
    'npm:@ssk_dev/pi-subagents-lean@0.19.4',
    { source: 'npm:@ssk_dev/pi-web-access-lean', extensions: [] },
    'npm:keep-permission-provider',
  ] });
  put(home, 'settings.json', settings);
  const report = inspectPiCatalog(config(), home, undefined, { cwd });
  assert.deepEqual(report.errors, []);
  const warnings = report.warnings.join('\n');
  assert.match(warnings, /Legacy @ssk_dev lean packages are configured/);
  assert.ok(warnings.includes(PI_RUNTIME) && warnings.includes(PI_WEB_RUNTIME));
  assert.match(warnings, /Installed runtime identity\/version is unverified/);
  assert.match(warnings, /Package agent\/workflow discovery and project trust are unverified/);
  assert.equal(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'), settings);
  put(home, 'settings.json', JSON.stringify({ packages: ['/local/node_modules/@gfgghgftgffg/pi-subagents-lean'] }));
  assert.equal(inspectPiCatalog(config(), home, undefined, { cwd }).warnings.some(w => w.startsWith('Legacy @ssk_dev')), false);
});

test('package workflow discovery disabled is not treated as native workflow execution disabled', t => {
  const home = fixture(t), cwd = fixture(t);
  const tuning = '{"packageAgents":false,"packageWorkflows":false,"workflowsEnabled":true}';
  put(home, 'subagents.json', tuning);
  const report = inspectPiCatalog(config(), home, undefined, { cwd });
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.some(w => w.includes('workflowsEnabled is false')), false);
  assert.equal(fs.readFileSync(path.join(home, 'subagents.json'), 'utf8'), tuning);
});

test('managed legacy-brand policy upgrades idempotently without changing roles, routes, packages or trust', t => {
  const c = config(), home = fixture(t), cwd = fixture(t), files = renderPi(c);
  const beforeConfig = JSON.stringify(c);
  const settings = '{"packages":["npm:@ssk_dev/pi-subagents-lean@0.19.4"],"defaultModel":"keep","defaultProjectTrust":"never"}';
  put(home, 'settings.json', settings);
  put(home, 'AGENTS.md', 'Keep unrelated operator instructions.\n');
  const old = new Map([...files].map(([name, text]) => [name, text.replaceAll('@gfgghgftgffg/', '@ssk_dev/')]));
  applyInstall(planPiInstall(old, home, { cwd }), home);
  const changes = planPiInstall(files, home, { cwd });
  assert.ok(changes.some(change => change.relative === 'AGENTS.md'));
  assert.equal(changes.some(change => change.relative.startsWith('agents/') || change.relative === 'settings.json' || change.relative === 'subagents.json'), false);
  applyInstall(changes, home);
  assert.equal(planPiInstall(files, home, { cwd }).length, 0);
  assert.equal(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'), settings);
  assert.ok(fs.readFileSync(path.join(home, 'AGENTS.md'), 'utf8').startsWith('Keep unrelated operator instructions.\n'));
  assert.equal(JSON.stringify(c), beforeConfig);
});
