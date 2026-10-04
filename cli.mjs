#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, loadConfig, render, inspectCatalog, readBaseInstructions, defaultCodexHome, planInstall, applyInstall } from './src/router.mjs';
import { defaultPiHome, renderPi, inspectPiCatalog, readPiSettings, planPiInstall, piModel } from './src/pi.mjs';

const HELP = `Task router (Node.js 22+)

node cli.mjs build   [--host codex|pi] [--config routing.toml] [--out PATH]
node cli.mjs doctor  [--host codex|pi] [--config routing.toml] [--catalog PATH]
node cli.mjs install [--host codex|pi] [--config routing.toml] [--apply]

--host defaults to codex, preserving existing commands.
--codex-home PATH selects Codex home; --pi-home PATH selects Pi agent dir.
Default build output: dist for Codex, dist/pi for Pi.
build writes an isolated bundle; install previews unless --apply is supplied.
Codex: separate profile, TOML roles and skill; config.toml is never rewritten.
Pi: own tr_* Markdown agents and opt-in skill through pi-subagents;
settings.json, builtin agents and credentials are never rewritten.
Pi --catalog expects a credential-free registry snapshot (see docs/pi.md).
`;

function runPi(command, c, values) {
  const home = path.resolve(values['pi-home'] || defaultPiHome());
  if (command === 'build') {
    const out = path.resolve(values.out || path.join(ROOT, 'dist', 'pi'));
    if ([home, path.resolve(defaultPiHome()), path.resolve(defaultCodexHome()), ROOT, path.parse(out).root].includes(out)) throw new Error('Build into an isolated output directory; use install for Pi agent dir.');
    const files = renderPi(c);
    const result = applyInstall(planPiInstall(files, out), out);
    console.log(`Built ${files.size} Pi artifacts in ${out} (${result.written} files updated).`);
    return;
  }
  const report = inspectPiCatalog(c, home, values.catalog);
  if (command === 'doctor') {
    console.table(report.rows);
    for (const message of report.warnings) console.log(`UNVERIFIED: ${message}`);
    for (const message of report.errors) console.error(`ERROR: ${message}`);
    process.exitCode = report.errors.length ? 1 : 0;
    return;
  }
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  for (const message of report.warnings) console.log(`UNVERIFIED: ${message}`);
  const base = readPiSettings(home);
  const changes = planPiInstall(renderPi(c), home, { base });
  console.log(`Target: ${home}`);
  for (const change of changes) console.log(`${change.content === undefined ? 'DELETE' : change.old === undefined ? 'CREATE' : 'UPDATE'} ${change.relative}`);
  if (!changes.length) console.log('Already up to date.');
  if (values.apply) {
    const result = applyInstall(changes, home);
    console.log(`Installed ${result.written} Pi files.${result.backup ? ` Backup: ${result.backup}` : ''}`);
    console.log('Install/load pi-subagents and pi-web-access separately; run /reload or start a new Pi session.');
    console.log(`Parent startup choice: model ${piModel(c.orchestrator)}; thinking ${c.orchestrator.effort}.`);
    console.log('Activate in the working project: /skill:task-routing <task>. Installation does not activate routing.');
  } else console.log('Preview only. Add --apply to install.');
}

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string' }, out: { type: 'string' }, 'codex-home': { type: 'string' },
    catalog: { type: 'string' }, host: { type: 'string', default: 'codex' }, 'pi-home': { type: 'string' },
    apply: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
  } });
  const command = positionals[0];
  if (values.help || !command) { console.log(HELP); process.exit(0); }
  if (!['build', 'doctor', 'install'].includes(command) || positionals.length !== 1) throw new Error('Choose build, doctor, or install; use --help.');
  if (!['codex', 'pi'].includes(values.host)) throw new Error('--host must be codex or pi');
  if (values.host === 'pi' && values['codex-home']) throw new Error('--codex-home is only valid with --host codex; use --pi-home');
  if (values.host === 'codex' && values['pi-home']) throw new Error('--pi-home is only valid with --host pi');
  if (values.apply && command !== 'install') throw new Error('--apply is only valid with install');
  if (values.out && command !== 'build') throw new Error('--out is only valid with build');
  const c = loadConfig(path.resolve(values.config || path.join(ROOT, 'routing.toml')));
  const home = path.resolve(values['codex-home'] || defaultCodexHome());
  if (values.host === 'pi') {
    runPi(command, c, values);
  } else if (command === 'doctor') {
    const report = inspectCatalog(c, home, values.catalog);
    console.table(report.rows);
    for (const message of report.warnings) console.log(`UNVERIFIED: ${message}`);
    for (const message of report.errors) console.error(`ERROR: ${message}`);
    process.exitCode = report.errors.length ? 1 : 0;
  } else if (command === 'build') {
    const out = path.resolve(values.out || path.join(ROOT, 'dist'));
    if (out === home || out === ROOT || out === path.parse(out).root) throw new Error('Build into an isolated output directory; use install for Codex home.');
    const changes = planInstall(render(c), out);
    const result = applyInstall(changes, out);
    console.log(`Built ${render(c).size} artifacts in ${out} (${result.written} files updated).`);
  } else {
    const report = inspectCatalog(c, home, values.catalog);
    if (report.errors.length) throw new Error(report.errors.join('\n'));
    for (const message of report.warnings) console.log(`UNVERIFIED: ${message}`);
    const base = readBaseInstructions(home);
    const changes = planInstall(render(c, { baseInstructions: base.text }), home, { base });
    console.log(`Target: ${home}`);
    for (const change of changes) console.log(`${change.content === undefined ? 'DELETE' : change.old === undefined ? 'CREATE' : 'UPDATE'} ${change.relative}`);
    if (!changes.length) console.log('Already up to date.');
    if (values.apply) {
      const result = applyInstall(changes, home);
      console.log(`Installed ${result.written} files.${result.backup ? ` Backup: ${result.backup}` : ''}`);
      console.log(`Start a new session: codex -p ${c.profile}`);
    } else console.log('Preview only. Add --apply to install.');
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
