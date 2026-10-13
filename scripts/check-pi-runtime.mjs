#!/usr/bin/env node
// Opt-in, no-model compatibility probe. Loads trusted installed extension code
// in a disposable home; ordinary Router build/doctor/install never loads it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadConfig, getRoleChoices } from '../src/router.mjs';
import { PI_RUNTIME, PI_WEB_RUNTIME, PI_ROLE_TOOLS, PI_DENIED_TOOLS, renderPi } from '../src/pi.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/check-pi-runtime.mjs <pi-sdk-package-dir> <subagents-package-dir> <web-access-package-dir>');
  console.log('Opt-in trusted-code load: isolated schemas/discovery/scope only; no credentials, models, MCP servers or actual child dispatch.');
  process.exit(0);
}
assert.equal(args.length, 3, 'Supply installed Pi SDK, amox subagents and amox web-access package directories; use --help.');
const [sdkDir, subagentsDir, webDir] = args.map(arg => path.resolve(arg));
const manifest = dir => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const sdkPackage = manifest(sdkDir), subPackage = manifest(subagentsDir), webPackage = manifest(webDir);
assert.equal(sdkPackage.name, '@earendil-works/pi-coding-agent');
assert.equal(subPackage.name, PI_RUNTIME); assert.equal(webPackage.name, PI_WEB_RUNTIME);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'task-router-pi-runtime-'));
const home = path.join(scratch, 'agent'), cwd = path.join(scratch, 'cwd');
fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(cwd);
process.env.PI_CODING_AGENT_DIR = home;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(scratch, 'sessions');
const c = loadConfig(path.join(ROOT, 'routing.toml')), choices = getRoleChoices(c);
for (const [relative, text] of renderPi(c)) {
  const target = path.join(home, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
}
fs.writeFileSync(path.join(home, 'subagents.json'), '{"fallbackSubagent":"none","strictAgentFiles":true,"workflowsEnabled":true}');
const evidence = { sdk: sdkPackage.version, wrapper: subPackage.version, engine: subPackage.dependencies['@tintinweb/pi-subagents'], webWrapper: webPackage.version, webEngine: webPackage.dependencies['pi-web-access'], checks: [], modelCalls: 0, childDispatches: 0 };
let loader;
try {
  const sdk = await import(pathToFileURL(path.resolve(sdkDir, sdkPackage.main)).href);
  const settingsManager = sdk.SettingsManager.inMemory({ packages: [], extensions: [], defaultProjectTrust: 'never' });
  loader = new sdk.DefaultResourceLoader({ cwd, agentDir: home, settingsManager, additionalExtensionPaths: [path.join(subagentsDir, 'index.ts'), path.join(webDir, 'index.ts')], noSkills: true, noPromptTemplates: true, noThemes: true });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const tools = loaded.extensions.flatMap(extension => [...extension.tools.values()].map(value => value.definition ?? value));
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['subagent', 'web_access']);
  const subagent = tools.find(tool => tool.name === 'subagent');
  const startupDescription = subagent.parameters.properties.subagent_type.description;
  assert.match(startupDescription, /^Agent types at startup: .+\.$/);
  const startupTypes = startupDescription.slice('Agent types at startup: '.length, -1).split(',').map(name => name.trim());
  for (const choice of choices) assert.ok(startupTypes.includes(choice.nativeRole), `missing registered candidate ${choice.nativeRole}`);
  evidence.checks.push(`SDK loads exactly two facades and discovers ${choices.length} Router candidates`);
  const help = async op => {
    const result = await subagent.execute(`help-${op}`, { op: 'help', input: op }, undefined, undefined, { cwd });
    const text = result.content.filter(entry => entry.type === 'text').map(entry => entry.text).join('\n');
    const offset = text.lastIndexOf('\nParameters:\n');
    assert.ok(offset >= 0, `missing ${op} schema`);
    return JSON.parse(text.slice(offset + '\nParameters:\n'.length));
  };
  const run = await help('run');
  assert.deepEqual(run.required, ['prompt', 'description', 'subagent_type']);
  for (const field of ['model', 'thinking', 'run_in_background', 'inherit_context', 'resume', 'isolated']) assert.ok(run.properties[field]);
  assert.equal(run.properties.thinking.type, 'string');
  for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) assert.ok(run.properties.thinking.description.includes(level));
  const workflow = await help('workflow');
  for (const field of ['script', 'scriptPath', 'name', 'args', 'resumeFromRunId']) assert.ok(workflow.properties[field]);
  for (const op of ['result', 'steer']) assert.ok((await help(op)).properties.agent_id);
  await assert.rejects(subagent.execute('invalid', { op: 'result', input: '{"agent_id":"missing","wait":"invalid"}' }, undefined, undefined, { cwd }), /parameters are invalid/);
  const missing = await subagent.execute('missing', { op: 'result', agent_id: 'no-such-router-agent' }, undefined, undefined, { cwd });
  assert.match(missing.content[0].text, /Agent not found/);
  evidence.checks.push('Real operation schemas and no-spawn result/error paths');

  // Use the actual pinned engine functions; only the session boundary is a
  // controlled test double. This is not real MCP or model execution evidence.
  let dependencyRoot = subagentsDir, engineDir;
  for (;;) {
    const candidate = path.join(dependencyRoot, 'node_modules', '@tintinweb/pi-subagents');
    if (fs.existsSync(path.join(candidate, 'package.json'))) { engineDir = candidate; break; }
    const parent = path.dirname(dependencyRoot);
    if (parent === dependencyRoot) throw new Error('Cannot locate the installed @tintinweb/pi-subagents dependency.');
    dependencyRoot = parent;
  }
  assert.equal(manifest(engineDir).version, evidence.engine, 'probe must load the exact dependency declared by the installed facade');
  const probePath = path.join(scratch, 'scope-helpers.ts');
  const sourcePath = relative => JSON.stringify(path.join(engineDir, relative).replaceAll('\\', '/'));
  fs.writeFileSync(probePath, `import { parseExtSelectors, extensionCanonicalNames, installExtensionToolScope } from ${sourcePath('src/agent-runner.ts')};
import { loadCustomAgents } from ${sourcePath('src/custom-agents.ts')};
export default function(pi) {
  pi.registerTool({ name: 'router_scope_helpers', label: 'Scope probe', description: 'Internal no-model test helpers.', parameters: { type: 'object', properties: {} },
    async execute() { return { content: [], details: { parseExtSelectors, extensionCanonicalNames, installExtensionToolScope, loadCustomAgents } }; }
  });
}`);
  const helperLoader = new sdk.DefaultResourceLoader({ cwd, agentDir: home, settingsManager, additionalExtensionPaths: [probePath], noSkills: true, noPromptTemplates: true, noThemes: true });
  await helperLoader.reload();
  const helperExtensions = helperLoader.getExtensions();
  assert.deepEqual(helperExtensions.errors, []);
  const helperTool = helperExtensions.extensions.flatMap(extension => [...extension.tools.values()].map(value => value.definition ?? value)).find(tool => tool.name === 'router_scope_helpers');
  assert.ok(helperTool);
  const { parseExtSelectors, extensionCanonicalNames, installExtensionToolScope, loadCustomAgents } = (await helperTool.execute()).details;
  assert.ok(extensionCanonicalNames(path.join(subagentsDir, 'index.ts')).includes('pi-subagents-lean'));
  assert.ok(extensionCanonicalNames(path.join(webDir, 'index.ts')).includes('pi-web-access-lean'));
  const parsed = loadCustomAgents(cwd, true, { packageDirs: [], packageFiles: [] });
  for (const choice of choices) {
    const config = parsed.get(choice.nativeRole);
    assert.ok(config); assert.equal(config.model, undefined); assert.equal(config.thinking, undefined);
    assert.equal(config.isolated, undefined); assert.equal(config.inheritContext, false);
  }
  evidence.checks.push('Actual frontmatter parser and short-name matching for scoped local packages');

  for (const [role, names] of Object.entries(PI_ROLE_TOOLS)) {
    const builtins = names.filter(name => !name.startsWith('ext:'));
    const { extNames, narrowing } = parseExtSelectors(names.filter(name => name.startsWith('ext:')));
    const definitions = new Map([...new Set([...builtins, 'subagent', 'web_access', 'web_extra', 'codemode', 'tool_search', 'mcp__test__write', 'late_write'])].map(name => [name, { name, exposure: name.startsWith('mcp__') ? 'deferred' : 'direct' }]));
    const extensions = [
      { path: path.join(subagentsDir, 'index.ts'), tools: new Map([['subagent', definitions.get('subagent')]]) },
      { path: path.join(webDir, 'index.ts'), tools: new Map(['web_access', 'web_extra'].map(name => [name, definitions.get(name)])) },
      { path: 'builtin:codemode', tools: new Map([['codemode', definitions.get('codemode')]]) },
      { path: 'builtin:tool-search', tools: new Map([['tool_search', definitions.get('tool_search')]]) },
      { path: 'builtin:mcp', tools: new Map([['mcp__test__write', definitions.get('mcp__test__write')]]) },
    ];
    let active = [...definitions.keys()], listener, priorCalls = 0;
    const session = { agent: { beforeToolCall: async () => { priorCalls++; return { block: false }; } }, getAllTools: () => [...definitions.values()], getToolDefinition: name => definitions.get(name), getActiveToolNames: () => active, setActiveToolsByName: names => { active = names; }, subscribe: callback => { listener = callback; } };
    const nestedCallGate = {};
    installExtensionToolScope(session, { loader: { getExtensions: () => ({ extensions }) }, toolNames: builtins, disallowedSet: new Set(PI_DENIED_TOOLS), extNames, narrowing, readmitToolNames: new Set(), nestedCallGate });
    const expected = [...builtins, ...(role === 'search' ? ['web_access'] : [])];
    assert.deepEqual(active.sort(), expected.sort(), `${role} exact tool set`);
    extensions[4].tools.set('late_write', definitions.get('late_write'));
    active.push('late_write'); listener({ type: 'turn_end' });
    assert.deepEqual(active.sort(), expected.sort());
    for (const name of ['subagent', 'codemode', 'tool_search', 'mcp__test__write', 'late_write', 'web_extra']) {
      assert.equal(nestedCallGate.allows(name), false, `${role} nested ${name}`);
      assert.equal((await session.agent.beforeToolCall({ toolCall: { name } })).block, true);
    }
    assert.equal(priorCalls, 0);
    for (const name of expected) {
      assert.equal(nestedCallGate.allows(name), true);
      assert.equal((await session.agent.beforeToolCall({ toolCall: { name } })).block, false);
    }
    assert.equal(priorCalls, expected.length, 'allowed calls retain the prior permission hook');
  }
  evidence.checks.push('All five roles keep exact scope across builtin/deferred tools, late registration, direct veto and nested-call gate');
  console.log(JSON.stringify(evidence, null, 2));
  console.log('PI RUNTIME CHECK PASS: no models, credentials, actual children or MCP servers tested.');
} finally {
  // No session was started; resource reload must not start long-lived handlers.
  fs.rmSync(scratch, { recursive: true, force: true });
}
