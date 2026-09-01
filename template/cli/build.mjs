#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = process.cwd();
const cfg = JSON.parse(await readFile(join(root, '.agent-plugin', 'config.json'), 'utf8'));
const slug = cfg.packageSlug ?? cfg.pluginId.replace(/^agent-foundry-/, '');
const platforms = cfg.supportedPlatforms ?? ['claude', 'codex', 'universal'];
const version = process.env.PLUGIN_VERSION ?? cfg.version ?? '0.1.0';
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/.test(version)) throw new Error(`Invalid PLUGIN_VERSION (expected X.Y.Z or X.Y.Z-beta.N): ${version}`);
async function digest(dir) { const h = createHash('sha256'); async function walk(d) { for (const e of (await readdir(d, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) { const p=join(d,e.name); if(e.isDirectory()) await walk(p); else { h.update(p.slice(dir.length).replaceAll('\\\\','/')); h.update(await readFile(p)); } } } await walk(dir); return h.digest('hex'); }
const canonicalDigest = await digest(join(root, 'src'));
await rm(join(root, 'plugins'), {recursive:true, force:true});
for (const platform of platforms) {
  const base = platform === 'universal' ? join(root, 'plugins', 'universal', '.agents', 'skills') : join(root, 'plugins', platform, cfg.pluginId);
  const skills = platform === 'universal' ? base : join(base, 'skills'); await mkdir(skills, {recursive:true});
  for (const e of (await readdir(join(root,'src','skills'), {withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))) {
    const outName = platform === 'claude' ? e.name : `${slug}-${e.name}`; const out=join(skills,outName); await mkdir(out,{recursive:true}); let body=await readFile(join(root,'src','skills',e.name,'SKILL.md'),'utf8'); if(platform!=='claude') body=body.replace(/^name:\\s*[^\\n]+/m,`name: ${outName}`); await writeFile(join(out,'SKILL.md'),body);
  }
  if(platform!=='universal'){for (const file of ['README.md','LICENSE','AGENTS.md']) if (existsSync(join(root,file))) await cp(join(root,file),join(base,file)); const md=platform==='claude'?'.claude-plugin':'.codex-plugin'; await mkdir(join(base,md),{recursive:true}); const manifest={name:cfg.pluginId,version,description:cfg.description,author:{name:cfg.authorName},repository:cfg.repositoryUrl,license:cfg.license??'MIT',skills:'./skills/'}; if(platform==='claude')manifest.displayName=cfg.displayName; await writeFile(join(base,md,'plugin.json'),JSON.stringify(manifest,null,2)+'\n');}
  const prov=platform==='universal'?join(root,'plugins','universal'):base; await mkdir(join(prov,'.agent-plugin'),{recursive:true}); await writeFile(join(prov,'.agent-plugin','provenance.json'),JSON.stringify({pluginId:cfg.pluginId,packageVersion:version,platform,canonicalDigest,generatorVersion:'1.0.0'},null,2)+'\n');
}
for (const platform of ['claude', 'codex']) {
  const marketplaceRoot = join(root, 'marketplaces', platform);
  await rm(marketplaceRoot, { recursive: true, force: true });
  const pluginSource = join(root, 'plugins', platform, cfg.pluginId);
  const pluginTarget = join(marketplaceRoot, 'plugins', cfg.pluginId);
  if (existsSync(pluginSource)) await cp(pluginSource, pluginTarget, { recursive: true });
  const manifestRoot = platform === 'claude' ? join(marketplaceRoot, '.claude-plugin') : join(marketplaceRoot, '.agents', 'plugins');
  await mkdir(manifestRoot, { recursive: true });
  const marketplace = platform === 'claude'
    ? { name: cfg.pluginId, owner: { name: cfg.authorName }, plugins: [{ name: cfg.pluginId, source: `./plugins/${cfg.pluginId}`, version }] }
    : { name: cfg.pluginId, plugins: [{ name: cfg.pluginId, source: `./plugins/${cfg.pluginId}`, version, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'development' }] };
  await writeFile(join(manifestRoot, 'marketplace.json'), JSON.stringify(marketplace, null, 2) + '\n');
}
const rootMarketplacePath = join(root, '.agents', 'plugins', 'marketplace.json');
await mkdir(join(root, '.agents', 'plugins'), { recursive: true });
await writeFile(rootMarketplacePath, JSON.stringify({
  name: cfg.pluginId,
  plugins: [{
    name: cfg.pluginId,
    source: `./plugins/codex/${cfg.pluginId}`,
    version,
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'development',
  }],
}, null, 2) + '\n');
console.log(`Rendered ${platforms.join(', ')} artifacts (${canonicalDigest})`);
