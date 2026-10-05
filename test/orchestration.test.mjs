import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'smol-toml';
import { ROOT, loadConfig, render, planInstall, applyInstall } from '../src/router.mjs';
import { renderPi, planPiInstall } from '../src/pi.mjs';

const policyPath = 'skills/task-routing/references/orchestration.md';
const config = () => loadConfig(path.join(ROOT, 'routing.toml'));
const bundles = () => ({ codex: render(config()), pi: renderPi(config()) });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-router-orchestration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function put(root, relative, content) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
  return filename;
}

// These are offline policy/bundle/installation regressions, not a claim that
// an LLM follows the policy. Runtime decision evals require separate evidence.
test('both hosts ship the same phase-level policy without another runtime dependency', () => {
  const source = fs.readFileSync(path.join(ROOT, 'skill/references/orchestration.md'), 'utf8');
  for (const [host, files] of Object.entries(bundles())) {
    assert.equal(files.get(policyPath), source, host);
    assert.match(files.get('skills/task-routing/SKILL.md'), /\(references\/orchestration\.md\)/);
    assert.match(files.get('skills/task-routing/references/role-map.md'), /\(orchestration\.md\)/);
    assert.match(files.get('AGENTS.md'), /not agent count or number of steps/);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies, { 'smol-toml': '1.9.0' });
  for (const url of [
    'https://www.anthropic.com/engineering/building-effective-agents',
    'https://www.anthropic.com/engineering/multi-agent-research-system',
    'https://developers.openai.com/codex/subagents',
    'https://openai.github.io/openai-agents-python/multi_agent/',
  ]) assert.ok(source.includes(url), url);
  assert.match(source, /SDK guidance, not a claim that Codex or Pi implements that SDK/);
});

test('multi-agent, parallel and acceptance work are not compulsory workflow triggers', () => {
  for (const files of Object.values(bundles())) {
    const skill = files.get('skills/task-routing/SKILL.md'), policy = files.get(policyPath);
    assert.match(skill, /Choose execution shape separately from model tier/);
    assert.match(skill, /More than one agent, parallel work, multiple steps, and independent verification do not require a workflow/);
    assert.match(policy, /short implementation\/verification\/repair sequence normally needs only direct coordination/);
    assert.match(policy, /failed child first needs diagnosis/);
    assert.doesNotMatch(skill, /For multi-step or parallel work,[\s\S]*?Use one native lean/);
  }
  const execution = bundles().pi.get('skills/task-routing/references/pi-execution.md');
  assert.match(execution, /multiple `op: "run"` tool calls in the same turn/);
  assert.match(execution, /Both run in the background; neither needs an enclosing script/);
  assert.match(execution, /launch the coder directly, then a separate verifier after target writes stop/);
});

test('workflow remains a useful conditional batch shape with explicit selection criteria', () => {
  const files = bundles().pi, policy = files.get(policyPath), execution = files.get('skills/task-routing/references/pi-execution.md');
  assert.match(policy, /clear input\/output contracts, dependencies, decision rules and stop conditions/);
  assert.match(policy, /discovered item list, variable item count, loops and known conditional branches are compatible/);
  assert.match(policy, /not a numeric score or keyword classifier/);
  assert.match(policy, /Honor an explicit user execution choice/);
  assert.match(execution, /Use this only for a selected scripted phase/);
  assert.match(execution, /op: "workflow"/);
  assert.match(execution, /NOT off/);
  assert.match(execution, /Check every required result and stop dependent stages on null/);
});

test('hybrid replanning keeps lifecycle, evidence and acceptance boundaries', () => {
  const files = bundles().pi, policy = files.get(policyPath), execution = files.get('skills/task-routing/references/pi-execution.md');
  for (const pattern of [
    /Do not lock an entire project into one mode/,
    /A pause is not completion/,
    /Account for outstanding children and any partial diff/,
    /mode changes are not context transfer/,
    /do not send direct result\/steer\/resume calls to their IDs/,
    /changing shape does not reset the same work unit's repairs/,
    /independent verify verdict on the actual diff and original criteria/,
    /Do not silently change execution mode to work around a provider/,
  ]) assert.match(policy, pattern);
  assert.match(execution, /Count live direct and workflow children together/);
  assert.match(execution, /Preserve null\/incomplete outcomes in the aggregate/);
  assert.match(execution, /Workflow children cannot be adopted by direct result\/steer\/resume/);
  assert.match(policy, /Do not claim automatic sibling context synchronization or a peer-to-peer messaging channel/);
});

test('host mapping preserves native Codex coordination and Pi lifecycle without cross-host APIs', () => {
  const { codex, pi } = bundles();
  for (const files of [codex, pi]) assert.match(files.get('skills/task-routing/SKILL.md'), /Do not transplant another plugin's API/);
  assert.equal(codex.has('skills/task-routing/references/pi-execution.md'), false);
  assert.equal(pi.has('skills/task-routing/references/parallel-work.md'), false);
  assert.match(codex.get('skills/task-routing/references/parallel-work.md'), /parent mediates evidence and follow-up instructions/);
  assert.match(pi.get('skills/task-routing/references/pi-execution.md'), /resume an eligible finished one/);
  for (const files of [codex, pi]) {
    for (const [relative, content] of files) {
      if (!relative.endsWith('.md')) continue;
      for (const match of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
        assert.ok(files.has(target), `${relative} references missing ${target}`);
      }
    }
  }
});

test('the capability gate covers both modes, either mode alone and neither in both entry skills', () => {
  const shapes = [];
  for (const files of Object.values(bundles())) {
    const skill = files.get('skills/task-routing/SKILL.md'), policy = files.get(policyPath);
    assert.match(skill, /Check the actual available delegation operations before dispatch, not the host\/plugin name/);
    assert.match(skill, /If direct subagents and workflows are both available/);
    assert.match(skill, /With direct subagents only, the parent coordinates all phases and dependencies through them/);
    assert.match(skill, /With workflows only, use short bounded phases and return evidence to the parent/);
    assert.match(skill, /With neither, keep eligible parent work here and report unavailable required delegation or acceptance/);
    assert.match(skill, /report explicitly required unavailable modes/);
    assert.match(policy, /one facade may expose both direct subagent and workflow operations/);
    assert.match(policy, /not by trying an unavailable API and falling back after failure/);
    assert.match(policy, /capability from a host or plugin name/);
    for (const row of ['Direct subagents and workflows', 'Direct subagents only', 'Workflows only', 'Neither']) assert.ok(policy.includes(`| ${row} |`));
    assert.match(files.get('skills/task-routing/references/role-map.md'), /Check actual delegation capabilities, not host\/plugin names/);
    assert.match(files.get('AGENTS.md'), /If only one is available, use it for bounded phases; do not invent the other/);
    const start = skill.indexOf("## Choose the current phase's shape");
    const end = skill.indexOf('\n## ', start + 1);
    assert.ok(start >= 0 && end > start, 'entry skill must contain the phase selection section');
    shapes.push(skill.slice(start, end).replace(/\r\n/g, '\n').trim());
    assert.doesNotMatch(skill, /In this Codex backend, all phases|Pi才|not an attempted workflow call followed by fallback/);
  }
  assert.equal(shapes[0], shapes[1], 'mode selection must not depend on the entry host');
  const execution = bundles().pi.get('skills/task-routing/references/pi-execution.md');
  assert.match(execution, /With workflows only, use the available workflow for the next bounded phase/);
  assert.match(execution, /do not require missing direct operations/);
});

test('phase policy scenarios distinguish adaptive work, stable batches, exceptions and infrastructure', () => {
  const policy = bundles().pi.get(policyPath);
  const rows = policy.split('\n').filter(line => line.startsWith('| '));
  for (const [task, mode] of [
    ['Investigate intermittent login failures', 'Direct coordination'],
    ['Check an SDK contract', 'Direct coordination'],
    ['Implement one bounded fix', 'Direct coordination'],
    ['Discover route files', 'Workflow on a capable executor'],
    ['Explore a migration', 'Hybrid'],
    ['A batch audit reveals', 'Return to parent at a safe boundary'],
    ['A provider rejects', 'Block the affected lane'],
  ]) {
    const row = rows.find(line => line.startsWith(`| ${task}`));
    assert.ok(row, `missing scenario: ${task}`);
    assert.equal(row.split('|')[2].trim(), mode);
  }
});

test('policy upgrades are installable and idempotent without changing roles or host settings', t => {
  for (const [host, files] of Object.entries(bundles())) {
    const home = fixture(t), cwd = fixture(t);
    const plan = next => host === 'pi' ? planPiInstall(next, home, { cwd }) : planInstall(next, home);
    const settingsPath = host === 'pi' ? 'settings.json' : 'config.toml';
    const settings = host === 'pi' ? '{"defaultProvider":"fixture","packages":[]}' : '# Keep operator settings\nmodel = "fixture"\n';
    put(home, settingsPath, settings);
    put(home, 'AGENTS.md', 'Keep operator instructions.\n');
    const previous = new Map(files);
    previous.delete(policyPath);
    previous.set('skills/task-routing/SKILL.md', '# Previous parent policy\n');
    applyInstall(plan(previous), home);
    const changes = plan(files);
    assert.ok(changes.some(change => change.relative === policyPath));
    assert.equal(changes.some(change => change.relative.startsWith('agents/') || change.relative === settingsPath), false);
    applyInstall(changes, home);
    assert.equal(fs.readFileSync(path.join(home, settingsPath), 'utf8'), settings);
    assert.ok(fs.readFileSync(path.join(home, 'AGENTS.md'), 'utf8').startsWith('Keep operator instructions.\n'));
    assert.equal(plan(files).length, 0);
  }
});

test('disabled workflows warn but do not block direct-only Pi installation', t => {
  const root = fixture(t), home = path.join(root, 'home');
  const c = config();
  c.orchestrator = { model: 'fixture-parent', effort: 'medium' };
  for (const role of Object.keys(c.roles)) c.roles[role] = { model: `fixture-${role}`, effort: 'medium' };
  const filename = put(root, 'routing.toml', stringify(c));
  const tuning = '{"workflowsEnabled":false,"strictAgentFiles":true,"fallbackSubagent":"none"}\n';
  put(home, 'subagents.json', tuning);
  const applied = spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), 'install', '--host', 'pi', '--config', filename, '--pi-home', home, '--apply'], { encoding: 'utf8', cwd: root });
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout + applied.stderr, /workflowsEnabled is false.*direct coordination remains available/);
  assert.equal(fs.readFileSync(path.join(home, 'subagents.json'), 'utf8'), tuning);
  assert.ok(fs.existsSync(path.join(home, 'agents/tr_coding.md')));
  const preview = spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), 'install', '--host', 'pi', '--config', filename, '--pi-home', home], { encoding: 'utf8', cwd: root });
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Already up to date/);
});
