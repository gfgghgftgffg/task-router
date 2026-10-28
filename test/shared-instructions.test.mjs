import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { ROOT, ROLE_META, SHARED_AGENTS_PATH, sharedInstructions, getRoleChoices, loadConfig, render, applyInstall } from '../src/router.mjs';
import { PI_MANIFEST, PI_MARKERS, PI_ROLE_TOOLS, PI_DENIED_TOOLS, renderPi, planPiInstall } from '../src/pi.mjs';

const config = () => loadConfig(path.join(ROOT, 'routing.toml'));
const read = filename => fs.readFileSync(filename, 'utf8');

// These checks validate generated instructions and tool declarations, not whether
// a model actually obeys them. The runtime scope probe covers nested tool calls.
test('both hosts point every role and parent skill at one live shared rule file', () => {
  const c = config(), codex = render(c), pi = renderPi(c);
  assert.equal(SHARED_AGENTS_PATH, path.join(ROOT, 'AGENTS.md').replaceAll('\\', '/'));
  assert.ok(path.isAbsolute(SHARED_AGENTS_PATH));
  assert.ok(fs.existsSync(SHARED_AGENTS_PATH));
  const shared = read(SHARED_AGENTS_PATH);
  for (const choice of getRoleChoices(c)) {
    const codexPath = `agents/task-routing/${choice.role}${choice.id === 'default' ? '' : `_${choice.id}`}.toml`;
    const instructions = parse(codex.get(codexPath)).developer_instructions;
    const piText = pi.get(`agents/${choice.nativeRole}.md`);
    assert.ok(instructions.startsWith(sharedInstructions() + '\n\n'));
    assert.ok(piText.includes('\n\n' + sharedInstructions() + '\n\n'));
    for (const text of [instructions, piText]) {
      assert.equal(text.split(SHARED_AGENTS_PATH).length - 1, 1);
      assert.ok(text.endsWith(read(path.join(ROOT, 'roles', `${choice.role}.md`))));
      assert.ok(!text.includes(shared), 'shared rules must be read live, not embedded as a snapshot');
    }
  }
  for (const files of [codex, pi]) {
    const skill = files.get('skills/task-routing/SKILL.md');
    assert.ok(skill.includes('`' + SHARED_AGENTS_PATH + '`'));
    assert.ok(!skill.includes('{{SHARED_AGENTS_PATH}}'));
    assert.ok(!skill.includes(shared));
    for (const role of Object.keys(ROLE_META)) {
      assert.ok(files.get(`skills/task-routing/references/roles/${role}.md`).startsWith(sharedInstructions()));
    }
  }
});

test('codemode is allowed for all Pi roles without widening mutation or delegation permissions', () => {
  const files = renderPi(config());
  for (const [role, tools] of Object.entries(PI_ROLE_TOOLS)) {
    assert.equal(tools.filter(tool => tool === 'ext:builtin:codemode/codemode').length, 1);
    assert.ok(!tools.includes('ext:builtin:mcp'));
    assert.ok(!tools.includes('ext:builtin:tool-search'));
    assert.ok(PI_DENIED_TOOLS.includes('subagent'));
    if (['search', 'reasoning'].includes(role)) {
      for (const name of ['bash', 'write', 'edit']) assert.ok(!tools.includes(name));
    }
    if (role === 'verify') for (const name of ['write', 'edit']) assert.ok(!tools.includes(name));
  }
  for (const [relative, content] of files) {
    if (!relative.startsWith('agents/')) continue;
    assert.match(content, /^prompt_mode: replace$/m);
    assert.match(content, /^inherit_context: false$/m);
    assert.match(content, /^allowed_subagents: none$/m);
    assert.match(content, /^skills: true$/m);
  }
});

test('Pi retires legacy global AGENTS ownership without rewriting, deleting or recreating the file', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-router-shared-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const files = renderPi(config()), old = new Map(files);
  assert.equal(files.has('AGENTS.md'), false);
  old.set('AGENTS.md', `${PI_MARKERS.start}\nOld Router block\n${PI_MARKERS.end}\n`);
  applyInstall(planPiInstall(old, home, { cwd: home }), home);
  const globalPath = path.join(home, 'AGENTS.md');
  const manual = '# Operator rules\nKeep this exact text, without a Router block.\n';
  fs.writeFileSync(globalPath, manual);
  const changes = planPiInstall(files, home, { cwd: home });
  assert.equal(changes.some(change => change.relative === 'AGENTS.md'), false);
  applyInstall(changes, home);
  assert.equal(read(globalPath), manual);
  assert.ok(!Object.hasOwn(JSON.parse(read(path.join(home, PI_MANIFEST))).files, 'AGENTS.md'));
  assert.equal(planPiInstall(files, home, { cwd: home }).length, 0);
  fs.rmSync(globalPath);
  assert.equal(planPiInstall(files, home, { cwd: home }).length, 0);
  assert.equal(fs.existsSync(globalPath), false);
});
