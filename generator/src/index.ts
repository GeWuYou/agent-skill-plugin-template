import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateNextVersion, parseVersion } from './version.js';

type Config = {
  pluginId: string; displayName: string; description: string; authorName: string;
  authorEmail?: string; license?: string; repositoryUrl: string; homepageUrl?: string;
  npmPackageName?: string; packageSlug?: string; version?: string;
  defaultSkillPrefix?: string; supportedPlatforms?: string[];
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const templateRoot = join(repoRoot, 'template');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function defaults(config: Config): Required<Config> {
  const slug = config.packageSlug ?? config.pluginId.replace(/^agent-foundry-/, '');
  return { ...config, authorEmail: config.authorEmail ?? '', license: config.license ?? 'MIT', homepageUrl: config.homepageUrl ?? config.repositoryUrl, npmPackageName: config.npmPackageName ?? `@agent-foundry/${slug}`, packageSlug: slug, version: config.version ?? '0.1.0', defaultSkillPrefix: config.defaultSkillPrefix ?? `${slug}-`, supportedPlatforms: config.supportedPlatforms ?? ['claude', 'codex', 'universal'] };
}

function configuredVersion(config: Config): string {
  const value = process.env.PLUGIN_VERSION ?? config.version ?? '0.1.0';
  parseVersion(value);
  return value;
}

async function hashTree(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(dir: string): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else { hash.update(path.slice(root.length).replaceAll('\\', '/')); hash.update(await readFile(path)); }
    }
  }
  await walk(root);
  return hash.digest('hex');
}

async function readConfig(project: string): Promise<Config> {
  const path = join(project, '.agent-plugin', 'config.json');
  return JSON.parse(await readFile(path, 'utf8')) as Config;
}

async function copyCanonical(project: string, destination: string): Promise<void> {
  for (const dir of ['references', 'contracts', 'schemas', 'tools', 'templates']) {
    const source = join(project, 'src', dir);
    if (existsSync(source)) await cp(source, join(destination, dir), { recursive: true });
  }
}

async function render(project: string): Promise<void> {
  const config = defaults(await readConfig(project));
  config.version = configuredVersion(config);
  const sourceSkills = join(project, 'src', 'skills');
  const digest = await hashTree(join(project, 'src'));
  const outRoot = join(project, 'plugins');
  await rm(outRoot, { recursive: true, force: true });
  for (const platform of config.supportedPlatforms) {
    const platformRoot = platform === 'universal' ? join(outRoot, 'universal', '.agents', 'skills') : join(outRoot, platform, config.pluginId);
    const skillsOut = platform === 'universal' ? platformRoot : join(platformRoot, 'skills');
    await mkdir(skillsOut, { recursive: true });
    for (const skill of (await readdir(sourceSkills, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const canonical = skill.name;
      const outputName = platform === 'claude' ? canonical : `${config.packageSlug}-${canonical}`;
      const skillOut = join(skillsOut, outputName);
      await mkdir(skillOut, { recursive: true });
      const source = join(sourceSkills, canonical, 'SKILL.md');
      let body = await readFile(source, 'utf8');
      if (platform !== 'claude') body = body.replace(/^name:\s*[^\n]+/m, `name: ${outputName}`).replaceAll(`@${canonical}`, `@${outputName}`);
      await writeFile(join(skillOut, 'SKILL.md'), body, 'utf8');
    }
    if (platform !== 'universal') {
      await copyCanonical(project, platformRoot);
      for (const file of ['README.md', 'LICENSE', 'AGENTS.md']) {
        if (existsSync(join(project, file))) await cp(join(project, file), join(platformRoot, file));
      }
      const manifestDir = join(platformRoot, platform === 'claude' ? '.claude-plugin' : '.codex-plugin');
      await mkdir(manifestDir, { recursive: true });
      const manifest = platform === 'claude' ? { name: config.pluginId, displayName: config.displayName, description: config.description, version: config.version, author: { name: config.authorName, email: config.authorEmail }, repository: config.repositoryUrl, license: config.license, skills: './skills/' } : { name: config.pluginId, version: config.version, description: config.description, author: { name: config.authorName, email: config.authorEmail }, homepage: config.homepageUrl, repository: config.repositoryUrl, license: config.license, skills: './skills/' };
      await writeFile(join(manifestDir, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    }
    const provenanceRoot = platform === 'universal' ? join(project, 'plugins', 'universal') : platformRoot;
    await mkdir(join(provenanceRoot, '.agent-plugin'), { recursive: true });
    await writeFile(join(provenanceRoot, '.agent-plugin', 'provenance.json'), JSON.stringify({ pluginId: config.pluginId, packageVersion: config.version, platform, canonicalDigest: digest, generatorVersion: '1.0.0' }, null, 2) + '\n', 'utf8');
  }
  await renderMarketplaces(project, config);
  await renderRootMarketplace(project, config);
}

async function renderMarketplaces(project: string, config: Required<Config>): Promise<void> {
  for (const platform of ['claude', 'codex']) {
    const root = join(project, 'marketplaces', platform);
    await rm(root, { recursive: true, force: true });
    const pluginPath = join(root, 'plugins', config.pluginId);
    await mkdir(pluginPath, { recursive: true });
    const source = join(project, 'plugins', platform, config.pluginId);
    if (existsSync(source)) await cp(source, pluginPath, { recursive: true });
    const manifestDir = platform === 'claude' ? join(root, '.claude-plugin') : join(root, '.agents', 'plugins');
    await mkdir(manifestDir, { recursive: true });
    const marketplace = platform === 'claude' ? { name: config.pluginId, owner: { name: config.authorName }, plugins: [{ name: config.pluginId, source: `./plugins/${config.pluginId}`, version: config.version }] } : { name: config.pluginId, plugins: [{ name: config.pluginId, source: `./plugins/${config.pluginId}`, version: config.version, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'development' }] };
    await writeFile(join(manifestDir, 'marketplace.json'), JSON.stringify(marketplace, null, 2) + '\n', 'utf8');
  }
}

async function renderRootMarketplace(project: string, config: Required<Config>): Promise<void> {
  const manifestPath = join(project, '.agents', 'plugins', 'marketplace.json');
  await mkdir(dirname(manifestPath), { recursive: true });
  const marketplace = {
    name: config.pluginId,
    plugins: [{
      name: config.pluginId,
      source: `./plugins/codex/${config.pluginId}`,
      version: config.version,
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'development',
    }],
  };
  await writeFile(manifestPath, JSON.stringify(marketplace, null, 2) + '\n', 'utf8');
}

async function init(destination: string): Promise<void> {
  if (existsSync(destination) && (await readdir(destination)).length) throw new Error(`Destination is not empty: ${destination}`);
  await mkdir(destination, { recursive: true });
  await cp(join(templateRoot, 'src'), join(destination, 'src'), { recursive: true });
  const exampleTemplate = join(destination, 'src', 'skills', 'example-skill', 'SKILL.md.tmpl');
  if (existsSync(exampleTemplate)) {
    await writeFile(join(destination, 'src', 'skills', 'example-skill', 'SKILL.md'), await readFile(exampleTemplate, 'utf8'), 'utf8');
    await rm(exampleTemplate);
  }
  await cp(join(templateRoot, 'tests'), join(destination, 'tests'), { recursive: true });
  await cp(join(templateRoot, 'cli'), join(destination, 'cli'), { recursive: true });
  for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE', 'AGENTS.md', 'CLAUDE.md', '.releaserc.json']) {
    const source = file === '.releaserc.json' ? join(repoRoot, file) : join(templateRoot, file);
    if (existsSync(source)) await cp(source, join(destination, file));
  }
  await mkdir(join(destination, '.agent-plugin'), { recursive: true });
  const config: Config = { pluginId: 'example-agent-plugin', displayName: 'Example Agent Plugin', description: 'A portable Agent Skills plugin.', authorName: 'Agent Foundry', repositoryUrl: 'https://example.invalid/example-agent-plugin' };
  await writeFile(join(destination, '.agent-plugin', 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
  await writeFile(join(destination, '.agent-plugin', 'template-provenance.json'), JSON.stringify({ templateVersion: '1.0.0', templateSource: 'agent-foundry/agent-skill-plugin-template', templateResolvedSha: null, generatorVersion: '1.0.0' }, null, 2) + '\n', 'utf8');
  await writeFile(join(destination, 'package.json'), JSON.stringify({ name: config.pluginId, version: config.version ?? '0.1.0', private: true, packageManager: 'bun@1.3.14', scripts: Object.fromEntries(['build', 'check', 'validate', 'install', 'update', 'uninstall', 'versions', 'doctor', 'sync-project', 'sync-docs', 'migrate'].map(command => [command, `node cli/index.mjs ${command}`])) }, null, 2) + '\n', 'utf8');
}

async function validateTemplate(): Promise<void> {
  const required = ['src/skills/example-skill/SKILL.md.tmpl', 'src/references', 'src/contracts', 'src/schemas', 'src/tools', 'src/templates', 'tests'];
  for (const path of required) if (!existsSync(join(templateRoot, path))) throw new Error(`Missing template path: ${path}`);
  const skill = await readFile(join(templateRoot, 'src/skills/example-skill/SKILL.md.tmpl'), 'utf8');
  if (!/^---\nname:\s*example-skill/m.test(skill)) throw new Error('Example skill frontmatter is invalid');
  console.log('template validation passed');
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'init') await init(resolve(process.argv[3] ?? 'agent-plugin'));
  else if (command === 'render') await render(resolve(arg('--project') ?? process.cwd()));
  else if (command === 'validate-template') await validateTemplate();
  else if (command === 'version') {
    const commits = (arg('--commits') ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const tags = (arg('--tags') ?? '').split(',').map(value => value.trim()).filter(Boolean);
    const result = calculateNextVersion({ baseVersion: arg('--base') ?? '0.1.0', commits, existingTags: tags, channel: (arg('--channel') as 'stable' | 'beta' | undefined) ?? 'stable' });
    console.log(JSON.stringify(result, null, 2));
  }
  else throw new Error('Usage: create-agent-plugin <init|render|validate-template|version> [path] [--project path]');
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
