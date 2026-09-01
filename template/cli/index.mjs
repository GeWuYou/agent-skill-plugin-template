#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const command = process.argv[2] ?? 'help';
const value = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const platform = value('--ai') ?? 'universal';
const configPath = join(root, '.agent-plugin', 'config.json');
const config = existsSync(configPath) ? JSON.parse(await readFile(configPath, 'utf8')) : {};
const packageVersion = process.env.PLUGIN_VERSION ?? config.version ?? '0.1.0';
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/.test(packageVersion)) throw new Error(`Invalid PLUGIN_VERSION (expected X.Y.Z or X.Y.Z-beta.N): ${packageVersion}`);
const pluginId = config.pluginId ?? 'plugin';
const slug = config.packageSlug ?? pluginId.replace(/^agent-foundry-/, '');
const sourceRoot = platform === 'universal' ? join(root, 'plugins', 'universal', '.agents', 'skills') : join(root, 'plugins', platform, pluginId);
const managedPath = join(root, '.agent-plugin', 'managed-files.json');

async function sha(path) { const h = createHash('sha256'); h.update(await readFile(path)); return h.digest('hex'); }
async function walk(dir) { const out=[]; if (!existsSync(dir)) return out; for (const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) { const p=join(dir,e.name); if(e.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; }
async function build() { const result = spawnSync(process.execPath, [join(root,'cli','build.mjs')], {cwd:root, stdio:'inherit'}); if (result.status !== 0) process.exit(result.status ?? 1); }
async function validate() { const skills = await walk(join(root,'src','skills')); if (!skills.some(p=>p.endsWith('SKILL.md'))) throw new Error('No canonical SKILL.md found under src/skills'); const p = join(sourceRoot, platform === 'universal' ? `${slug}-example-skill` : 'skills'); if (!existsSync(join(root,'plugins'))) throw new Error('Generated plugins are missing; run build'); console.log(`validated ${skills.filter(p=>p.endsWith('SKILL.md')).length} canonical files`); }
async function managedFiles(target) { const files = await walk(sourceRoot); const records=[]; for (const source of files) { const rel=relative(sourceRoot,source); const dest=join(target,rel); records.push({path:relative(root,dest).replaceAll('\\','/'), source:relative(root,source).replaceAll('\\','/'), sha256:await sha(source)}); } return records; }
async function install(mode) { await build(); const target=resolve(value('--target') ?? root); const records=await managedFiles(target); const conflicts=[]; for (const r of records) { const dest=resolve(root,r.path); if(existsSync(dest) && (await sha(dest)) !== r.sha256) conflicts.push(r.path); } if(conflicts.length) throw new Error(`managed file conflict: ${conflicts.join(', ')}`); for(const r of records){const dest=resolve(root,r.path); const source=resolve(root,r.source); if(dest===source) continue; await mkdir(join(dest,'..'),{recursive:true}); await cp(source,dest); } await mkdir(join(root,'.agent-plugin'),{recursive:true}); await writeFile(managedPath,JSON.stringify({version:1,platform,target,files:records},null,2)+'\n'); console.log(`${mode} complete (${records.length} managed files)`); }
async function uninstall() { if(!existsSync(managedPath)){console.log('no managed installation found');return;} const state=JSON.parse(await readFile(managedPath,'utf8')); const modified=[]; for(const r of state.files??[]){const p=resolve(root,r.path); if(existsSync(p) && (await sha(p))!==r.sha256) modified.push(r.path);} if(modified.length) throw new Error(`refusing to remove modified files: ${modified.join(', ')}`); for(const r of state.files??[]){const p=resolve(root,r.path); if(existsSync(p)) await rm(p);} await rm(managedPath,{force:true}); console.log('uninstall complete'); }
async function doctor() { if (!existsSync(configPath)) throw new Error('missing .agent-plugin/config.json'); if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginId)) throw new Error('pluginId must be lowercase kebab case'); console.log(`doctor ok: ${pluginId}`); }
async function main(){ if(command==='build') await build(); else if(command==='check'||command==='validate') await validate(); else if(command==='install'||command==='update') await install(command); else if(command==='uninstall') await uninstall(); else if(command==='versions') console.log(JSON.stringify({packageVersion,templateVersion:'1.0.0'},null,2)); else if(command==='doctor') await doctor(); else if(['sync-project','sync-docs','migrate'].includes(command)) console.log(`${command}: no project-specific changes configured`); else console.log('Usage: node cli/index.mjs <build|check|validate|install|update|uninstall|versions|doctor|sync-project|sync-docs|migrate> [--ai claude|codex|universal] [--target path]'); }
main().catch(e=>{console.error(e.message);process.exitCode=1;});
