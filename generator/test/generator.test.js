import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { calculateNextVersion, parseTag } from '../dist/version.js';

const repoRoot = join(import.meta.dirname, '..');
const cli = join(repoRoot, 'dist', 'index.js');
function run(args, cwd, env = {}) { return new Promise((resolve, reject) => { const p = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, ...env } }); let out=''; p.stdout.on('data', d=>out+=d); p.stderr.on('data', d=>out+=d); p.on('close', code=>code===0?resolve(out):reject(new Error(out))); }); }
test('init creates a generic project with a stable default version', async () => { const d=await mkdtemp(join(tmpdir(),'agent-plugin-')); try { await run(['init', d]); const cfg=JSON.parse(await readFile(join(d,'.agent-plugin','config.json'),'utf8')); assert.equal(cfg.pluginId,'example-agent-plugin'); assert.equal(cfg.version, undefined); assert.equal(JSON.parse(await readFile(join(d,'package.json'),'utf8')).version, '0.1.0'); const release=JSON.parse(await readFile(join(d,'.releaserc.json'),'utf8')); assert.deepEqual(release.branches, ['main']); assert.equal(release.tagFormat, 'v${version}'); assert.ok(JSON.parse(await readFile(join(d,'.agent-plugin','template-provenance.json'),'utf8')).templateVersion); } finally { await rm(d,{recursive:true,force:true}); } });
test('validate-template accepts the canonical scaffold', async () => { const output=await run(['validate-template'], repoRoot); assert.match(output,/passed/); });
test('release configuration mirrors the supported Graft rules', async () => {
  const release = JSON.parse(await readFile(join(repoRoot, '..', '.releaserc.json'), 'utf8'));
  assert.deepEqual(release.branches, ['main']); assert.equal(release.tagFormat, 'v${version}');
  const rules = release.plugins[0][1].releaseRules;
  assert.equal(rules.find(rule => rule.type === 'feat').release, 'minor');
  assert.equal(rules.find(rule => rule.type === 'fix').release, 'patch');
  assert.equal(rules.find(rule => rule.type === 'docs').release, false);
});
test('initialized project exposes the complete lifecycle command surface', async () => { const d=await mkdtemp(join(tmpdir(),'agent-plugin-')); try { await run(['init', d]); const pkg=JSON.parse(await readFile(join(d,'package.json'),'utf8')); for (const command of ['build','check','validate','install','update','uninstall','versions','doctor','sync-project','sync-docs','migrate']) assert.ok(pkg.scripts[command], `missing ${command}`); assert.equal(pkg.packageManager,'bun@1.3.14'); } finally { await rm(d,{recursive:true,force:true}); } });
test('generated lifecycle CLI builds and validates artifacts', async () => { const d=await mkdtemp(join(tmpdir(),'agent-plugin-')); try { await run(['init', d]); await run(['render','--project',d]); const output=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[join(d,'cli','index.mjs'),'check'],{cwd:d});let out='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>out+=x);p.on('close',c=>c===0?resolve(out):reject(new Error(out)));}); assert.match(String(output),/validated/); } finally { await rm(d,{recursive:true,force:true}); } });
test('version calculator follows Graft conventional commit rules', () => {
  assert.equal(calculateNextVersion({ baseVersion: '0.1.0', previousStableTag: 'v0.1.0', commits: ['docs: update guide'] }).version, null);
  assert.equal(calculateNextVersion({ baseVersion: '0.1.0', previousStableTag: 'v0.1.0', commits: ['fix: correct manifest'] }).tag, 'v0.1.1');
  assert.equal(calculateNextVersion({ baseVersion: '0.1.0', previousStableTag: 'v0.1.0', commits: ['feat: add skill'] }).tag, 'v0.2.0');
  assert.equal(calculateNextVersion({ baseVersion: '0.1.0', previousStableTag: 'v0.1.0', commits: ['fix!: change contract'] }).tag, 'v1.0.0');
  assert.equal(calculateNextVersion({ baseVersion: '0.1.0', previousStableTag: 'v0.1.0', channel: 'beta', commits: ['feat: add skill'], existingTags: ['v0.2.0-beta.1'] }).tag, 'v0.2.0-beta.2');
  assert.throws(() => parseTag('v0.1.0-rc.1'), /expected vX\.Y\.Z/);
  assert.throws(() => parseTag('v0.1.0-beta.0'), /expected vX\.Y\.Z/);
  assert.throws(() => parseTag('v0.01.0'), /expected vX\.Y\.Z/);
});
test('first release uses the configured base without bumping pre-baseline commits', () => {
  assert.equal(calculateNextVersion({ baseVersion: '0.1.0', commits: ['docs: pre-baseline documentation'] }).version, null);
  assert.deepEqual(calculateNextVersion({ baseVersion: '0.1.0', commits: ['feat: pre-baseline'] }), { channel: 'stable', releaseType: 'minor', version: '0.1.0', tag: 'v0.1.0', baseVersion: '0.1.0', previousStableTag: null });
  const beta = calculateNextVersion({ baseVersion: '0.1.0', channel: 'beta', commits: ['feat: pre-baseline'], existingTags: ['v0.1.0-beta.1', 'v0.1.0-beta.3'] });
  assert.equal(beta.tag, 'v0.1.0-beta.4'); assert.equal(beta.releaseType, 'minor');
});
test('render accepts a CI version without mutating project config', async () => {
  const d=await mkdtemp(join(tmpdir(),'agent-plugin-')); try {
    await run(['init', d]);
    const before=JSON.parse(await readFile(join(d,'.agent-plugin','config.json'),'utf8'));
    await run(['render','--project',d], undefined, { PLUGIN_VERSION: '1.2.3-beta.2' });
    const claude=JSON.parse(await readFile(join(d,'plugins','claude',before.pluginId,'.claude-plugin','plugin.json'),'utf8'));
    const codex=JSON.parse(await readFile(join(d,'plugins','codex',before.pluginId,'.codex-plugin','plugin.json'),'utf8'));
    const provenance=JSON.parse(await readFile(join(d,'plugins','universal','.agent-plugin','provenance.json'),'utf8'));
    const codexMarketplace=JSON.parse(await readFile(join(d,'marketplaces','codex','.agents','plugins','marketplace.json'),'utf8'));
    const rootMarketplace=JSON.parse(await readFile(join(d,'.agents','plugins','marketplace.json'),'utf8'));
    assert.equal(claude.version, '1.2.3-beta.2'); assert.equal(codex.version, claude.version); assert.equal(provenance.packageVersion, claude.version);
    assert.equal(codexMarketplace.plugins[0].version, claude.version);
    assert.equal(rootMarketplace.plugins[0].source, `./plugins/codex/${before.pluginId}`);
    assert.equal(rootMarketplace.plugins[0].version, claude.version);
    assert.deepEqual(rootMarketplace.plugins[0].policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
    assert.deepEqual(JSON.parse(await readFile(join(d,'.agent-plugin','config.json'),'utf8')), before);
  } finally { await rm(d,{recursive:true,force:true}); }
});
test('generated project CLI builds every artifact with PLUGIN_VERSION', async () => {
  const d=await mkdtemp(join(tmpdir(),'agent-plugin-')); try {
    await run(['init', d]);
    const configBefore=await readFile(join(d,'.agent-plugin','config.json'),'utf8');
    await new Promise((resolve,reject)=>{ const p=spawn(process.execPath,[join(d,'cli','index.mjs'),'build'],{cwd:d,env:{...process.env,PLUGIN_VERSION:'2.0.0-beta.1'}}); let out=''; p.stdout.on('data',x=>out+=x); p.stderr.on('data',x=>out+=x); p.on('close',c=>c===0?resolve(out):reject(new Error(out))); });
    const cfg=JSON.parse(configBefore);
    const claude=JSON.parse(await readFile(join(d,'plugins','claude',cfg.pluginId,'.claude-plugin','plugin.json'),'utf8'));
    const codexMarketplace=JSON.parse(await readFile(join(d,'marketplaces','codex','.agents','plugins','marketplace.json'),'utf8'));
    const rootMarketplace=JSON.parse(await readFile(join(d,'.agents','plugins','marketplace.json'),'utf8'));
    const provenance=JSON.parse(await readFile(join(d,'plugins','universal','.agent-plugin','provenance.json'),'utf8'));
    assert.equal(claude.version, '2.0.0-beta.1'); assert.equal(codexMarketplace.plugins[0].version, claude.version); assert.equal(rootMarketplace.plugins[0].version, claude.version); assert.equal(rootMarketplace.plugins[0].source, `./plugins/codex/${cfg.pluginId}`); assert.equal(provenance.packageVersion, claude.version); assert.equal(await readFile(join(d,'.agent-plugin','config.json'),'utf8'), configBefore);
  } finally { await rm(d,{recursive:true,force:true}); }
});
