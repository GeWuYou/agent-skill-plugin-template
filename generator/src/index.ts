#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SupportedPlatform = 'claude' | 'codex' | 'universal';

export interface TemplateConfig {
  pluginId: string;
  displayName: string;
  description: string;
  authorName: string;
  authorEmail?: string;
  authorUrl?: string;
  license?: string;
  repositoryUrl: string;
  homepageUrl?: string;
  packageName?: string;
  packageSlug?: string;
  version?: string;
  defaultSkillPrefix?: string;
  supportedPlatforms?: SupportedPlatform[];
  shortDescription?: string;
  longDescription?: string;
  developerName?: string;
  category?: string;
  capabilities?: string[];
  defaultPrompts?: string[];
  brandColor?: string;
}

export interface NormalizedTemplateConfig extends TemplateConfig {
  license: string;
  homepageUrl: string;
  packageName: string;
  packageSlug: string;
  version: string;
  defaultSkillPrefix: string;
  supportedPlatforms: SupportedPlatform[];
  shortDescription: string;
  longDescription: string;
  developerName: string;
  category: string;
  capabilities: string[];
  defaultPrompts: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const templateRoot = join(repoRoot, 'template');
const strictVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeConfig(config: TemplateConfig): NormalizedTemplateConfig {
  const packageSlug = nonEmpty(config.packageSlug) ?? config.pluginId.replace(/^gewuyou-/, '');
  const description = config.description.trim();
  const capabilities = config.capabilities?.map(value => value.trim()).filter(Boolean) ?? [];
  const defaultPrompts = config.defaultPrompts?.map(value => value.trim().slice(0, 128)).filter(Boolean).slice(0, 3) ?? [];
  const supportedPlatforms = config.supportedPlatforms ?? ['claude', 'codex', 'universal'];
  if (!supportedPlatforms.length || new Set(supportedPlatforms).size !== supportedPlatforms.length || supportedPlatforms.some(platform => !['claude', 'codex', 'universal'].includes(platform))) {
    throw new Error('supportedPlatforms must contain unique Claude, Codex, or Universal targets');
  }
  return {
    ...config,
    ...(nonEmpty(config.authorEmail) ? { authorEmail: nonEmpty(config.authorEmail) } : { authorEmail: undefined }),
    ...(nonEmpty(config.authorUrl) ? { authorUrl: nonEmpty(config.authorUrl) } : { authorUrl: undefined }),
    ...(nonEmpty(config.brandColor) ? { brandColor: nonEmpty(config.brandColor) } : { brandColor: undefined }),
    license: nonEmpty(config.license) ?? 'MIT',
    homepageUrl: nonEmpty(config.homepageUrl) ?? config.repositoryUrl,
    packageName: nonEmpty(config.packageName) ?? `@gewuyou/${packageSlug}`,
    packageSlug,
    version: nonEmpty(config.version) ?? '0.0.0',
    defaultSkillPrefix: config.defaultSkillPrefix ?? `${packageSlug}-`,
    supportedPlatforms,
    shortDescription: nonEmpty(config.shortDescription) ?? description,
    longDescription: nonEmpty(config.longDescription) ?? description,
    developerName: nonEmpty(config.developerName) ?? config.authorName,
    category: nonEmpty(config.category) ?? 'Development',
    capabilities: capabilities.length ? capabilities : ['Skills'],
    defaultPrompts: defaultPrompts.length ? defaultPrompts : [`Use ${config.displayName} to help with this task.`.slice(0, 128)],
  };
}

function configuredVersion(config: TemplateConfig): string {
  const value = process.env.PLUGIN_VERSION ?? config.version ?? '0.0.0';
  if (!strictVersion.test(value)) throw new Error(`Invalid stable version: ${value}`);
  return value;
}

async function hashTree(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        hash.update(path.slice(root.length).replaceAll('\\', '/'));
        hash.update(await readFile(path));
      }
    }
  }
  await walk(root);
  return hash.digest('hex');
}

async function readConfig(project: string): Promise<TemplateConfig> {
  return JSON.parse(await readFile(join(project, '.agent-plugin', 'config.json'), 'utf8')) as TemplateConfig;
}

async function copyCanonical(project: string, destination: string): Promise<void> {
  for (const directory of ['references', 'contracts', 'schemas', 'tools', 'templates']) {
    const source = join(project, 'src', directory);
    if (existsSync(source)) await cp(source, join(destination, directory), { recursive: true });
  }
}

function rewrittenSkillText(body: string, canonicalName: string, outputName: string): string {
  if (canonicalName === outputName) return body;
  return body
    .replace(/^name:\s*[^\n]+/m, `name: ${outputName}`)
    .replaceAll(`$${canonicalName}`, `$${outputName}`)
    .replaceAll(`@${canonicalName}`, `@${outputName}`);
}

async function copySkillDirectory(source: string, destination: string, canonicalName: string, outputName: string): Promise<void> {
  await cp(source, destination, { recursive: true });
  const templatePath = join(destination, 'SKILL.md.tmpl');
  const skillPath = join(destination, 'SKILL.md');
  if (existsSync(templatePath)) {
    await writeFile(skillPath, await readFile(templatePath, 'utf8'), 'utf8');
    await rm(templatePath);
  }
  if (!existsSync(skillPath)) throw new Error(`Skill ${canonicalName} is missing SKILL.md`);
  await writeFile(skillPath, rewrittenSkillText(await readFile(skillPath, 'utf8'), canonicalName, outputName), 'utf8');
  const openAiPath = join(destination, 'agents', 'openai.yaml');
  if (existsSync(openAiPath)) await writeFile(openAiPath, rewrittenSkillText(await readFile(openAiPath, 'utf8'), canonicalName, outputName), 'utf8');
}

function author(config: NormalizedTemplateConfig): Record<string, string> {
  return {
    name: config.authorName,
    ...(config.authorEmail ? { email: config.authorEmail } : {}),
    ...(config.authorUrl ? { url: config.authorUrl } : {}),
  };
}

function codexInterface(config: NormalizedTemplateConfig): Record<string, unknown> {
  return {
    displayName: config.displayName,
    shortDescription: config.shortDescription,
    longDescription: config.longDescription,
    developerName: config.developerName,
    category: config.category,
    capabilities: config.capabilities,
    websiteURL: config.homepageUrl,
    defaultPrompt: config.defaultPrompts,
    ...(config.brandColor ? { brandColor: config.brandColor } : {}),
  };
}

export async function validateSkillDirectory(skillRoot: string): Promise<void> {
  const skillName = skillRoot.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const skillPath = join(skillRoot, 'SKILL.md');
  if (!existsSync(skillPath)) throw new Error(`Missing Skill entrypoint: ${skillPath}`);
  const skill = await readFile(skillPath, 'utf8');
  const escapedName = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^---\\r?\\nname:\\s*${escapedName}\\s*$`, 'm').test(skill)) throw new Error(`Skill frontmatter name must match directory: ${skillName}`);
  const openAiPath = join(skillRoot, 'agents', 'openai.yaml');
  if (existsSync(openAiPath)) {
    const metadata = await readFile(openAiPath, 'utf8');
    if (!metadata.includes(`$${skillName}`)) throw new Error(`agents/openai.yaml must reference $${skillName}`);
  }
}

export async function validateCodexPlugin(pluginRoot: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>;
  for (const field of ['name', 'version', 'description', 'author', 'interface']) if (manifest[field] === undefined) throw new Error(`Codex plugin manifest is missing ${field}`);
  if (typeof manifest.version !== 'string' || !strictVersion.test(manifest.version)) throw new Error('Codex plugin version is not valid SemVer');
  const manifestAuthor = manifest.author as Record<string, unknown>;
  if (typeof manifestAuthor.name !== 'string' || !manifestAuthor.name.trim()) throw new Error('Codex plugin author.name is required');
  for (const field of ['url', 'email']) if (manifestAuthor[field] === '') throw new Error(`Codex plugin author.${field} must be omitted when empty`);
  const metadata = manifest.interface as Record<string, unknown>;
  for (const field of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category', 'capabilities', 'defaultPrompt']) if (metadata[field] === undefined || metadata[field] === '') throw new Error(`Codex plugin interface is missing ${field}`);
  if (!Array.isArray(metadata.capabilities) || metadata.capabilities.length === 0) throw new Error('Codex plugin capabilities must not be empty');
  if (!Array.isArray(metadata.defaultPrompt) || metadata.defaultPrompt.length === 0 || metadata.defaultPrompt.length > 3) throw new Error('Codex plugin defaultPrompt must contain one to three prompts');
  if (metadata.defaultPrompt.some(prompt => typeof prompt !== 'string' || !prompt || prompt.length > 128)) throw new Error('Codex plugin defaultPrompt entries must be non-empty and at most 128 characters');
  for (const field of ['websiteURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    if (metadata[field] !== undefined && (typeof metadata[field] !== 'string' || !metadata[field].startsWith('https://'))) throw new Error(`Codex plugin interface.${field} must use https`);
  }
}

export async function validateCodexMarketplace(manifestPath: string): Promise<void> {
  const marketplace = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  const metadata = marketplace.interface as Record<string, unknown> | undefined;
  if (typeof metadata?.displayName !== 'string' || !metadata.displayName.trim()) throw new Error('Codex marketplace interface.displayName is required');
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) throw new Error('Codex marketplace plugins must not be empty');
  for (const plugin of marketplace.plugins as Array<Record<string, unknown>>) {
    const source = plugin.source as Record<string, unknown> | undefined;
    if (source?.source !== 'local' || typeof source.path !== 'string' || !source.path.startsWith('./plugins/')) throw new Error('Codex marketplace source must be a local object path');
    const policy = plugin.policy as Record<string, unknown> | undefined;
    if (!['AVAILABLE', 'NOT_AVAILABLE', 'INSTALLED_BY_DEFAULT'].includes(String(policy?.installation))) throw new Error('Codex marketplace installation policy is invalid');
    if (!['ON_INSTALL', 'ON_USE'].includes(String(policy?.authentication))) throw new Error('Codex marketplace authentication policy is invalid');
    if (typeof plugin.category !== 'string' || !plugin.category) throw new Error('Codex marketplace category is required');
  }
}

async function validateGenerated(project: string, config: NormalizedTemplateConfig): Promise<void> {
  for (const platform of config.supportedPlatforms) {
    const skillsRoot = platform === 'universal' ? join(project, 'plugins', 'universal', '.agents', 'skills') : join(project, 'plugins', platform, config.pluginId, 'skills');
    for (const entry of await readdir(skillsRoot, { withFileTypes: true })) if (entry.isDirectory()) await validateSkillDirectory(join(skillsRoot, entry.name));
  }
  if (config.supportedPlatforms.includes('codex')) {
    await validateCodexPlugin(join(project, 'plugins', 'codex', config.pluginId));
    await validateCodexMarketplace(join(project, 'marketplaces', 'codex', '.agents', 'plugins', 'marketplace.json'));
    await validateCodexMarketplace(join(project, '.agents', 'plugins', 'marketplace.json'));
  }
}

async function render(project: string): Promise<void> {
  const config = normalizeConfig(await readConfig(project));
  config.version = configuredVersion(config);
  const sourceSkills = join(project, 'src', 'skills');
  const digest = await hashTree(join(project, 'src'));
  const outRoot = join(project, 'plugins');
  await rm(outRoot, { recursive: true, force: true });
  for (const platform of config.supportedPlatforms) {
    const platformRoot = platform === 'universal' ? join(outRoot, 'universal', '.agents', 'skills') : join(outRoot, platform, config.pluginId);
    const skillsOut = platform === 'universal' ? platformRoot : join(platformRoot, 'skills');
    await mkdir(skillsOut, { recursive: true });
    const skillEntries = (await readdir(sourceSkills, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const skill of skillEntries) {
      const canonicalName = skill.name;
      const outputName = platform === 'claude' ? canonicalName : `${config.defaultSkillPrefix}${canonicalName}`;
      await copySkillDirectory(join(sourceSkills, canonicalName), join(skillsOut, outputName), canonicalName, outputName);
    }
    if (platform !== 'universal') {
      await copyCanonical(project, platformRoot);
      for (const file of ['README.md', 'LICENSE', 'AGENTS.md']) if (existsSync(join(project, file))) await cp(join(project, file), join(platformRoot, file));
      const manifestDirectory = join(platformRoot, platform === 'claude' ? '.claude-plugin' : '.codex-plugin');
      await mkdir(manifestDirectory, { recursive: true });
      const manifest = platform === 'claude'
        ? { name: config.pluginId, displayName: config.displayName, description: config.description, version: config.version, author: author(config), repository: config.repositoryUrl, license: config.license, skills: './skills/' }
        : { name: config.pluginId, version: config.version, description: config.description, author: author(config), homepage: config.homepageUrl, repository: config.repositoryUrl, license: config.license, skills: './skills/', interface: codexInterface(config) };
      await writeFile(join(manifestDirectory, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
    const provenanceRoot = platform === 'universal' ? join(project, 'plugins', 'universal') : platformRoot;
    await mkdir(join(provenanceRoot, '.agent-plugin'), { recursive: true });
    await writeFile(join(provenanceRoot, '.agent-plugin', 'provenance.json'), `${JSON.stringify({ pluginId: config.pluginId, packageVersion: config.version, platform, canonicalDigest: digest, generatorVersion: '1.0.0' }, null, 2)}\n`, 'utf8');
  }
  await renderMarketplaces(project, config);
  await renderRootMarketplace(project, config);
  await validateGenerated(project, config);
}

async function renderMarketplaces(project: string, config: NormalizedTemplateConfig): Promise<void> {
  for (const platform of ['claude', 'codex'] as const) {
    const root = join(project, 'marketplaces', platform);
    await rm(root, { recursive: true, force: true });
    if (!config.supportedPlatforms.includes(platform)) continue;
    const pluginPath = join(root, 'plugins', config.pluginId);
    await mkdir(pluginPath, { recursive: true });
    await cp(join(project, 'plugins', platform, config.pluginId), pluginPath, { recursive: true });
    const manifestDirectory = platform === 'claude' ? join(root, '.claude-plugin') : join(root, '.agents', 'plugins');
    await mkdir(manifestDirectory, { recursive: true });
    const marketplace = platform === 'claude'
      ? { name: config.pluginId, owner: { name: config.authorName }, plugins: [{ name: config.pluginId, source: `./plugins/${config.pluginId}`, version: config.version }] }
      : { name: config.pluginId, interface: { displayName: config.displayName }, plugins: [{ name: config.pluginId, source: { source: 'local', path: `./plugins/${config.pluginId}` }, version: config.version, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: config.category }] };
    await writeFile(join(manifestDirectory, 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`, 'utf8');
  }
}

async function renderRootMarketplace(project: string, config: NormalizedTemplateConfig): Promise<void> {
  const manifestPath = join(project, '.agents', 'plugins', 'marketplace.json');
  if (!config.supportedPlatforms.includes('codex')) {
    await rm(manifestPath, { force: true });
    return;
  }
  await mkdir(dirname(manifestPath), { recursive: true });
  const marketplace = {
    name: config.pluginId,
    interface: { displayName: config.displayName },
    plugins: [{ name: config.pluginId, source: { source: 'local', path: `./plugins/codex/${config.pluginId}` }, version: config.version, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: config.category }],
  };
  await writeFile(manifestPath, `${JSON.stringify(marketplace, null, 2)}\n`, 'utf8');
}

async function copyTemplateAssets(destination: string): Promise<void> {
  for (const directory of ['src', 'tests', 'cli', 'ci', '.github']) {
    const source = join(templateRoot, directory);
    if (existsSync(source)) await cp(source, join(destination, directory), { recursive: true });
  }
  for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE', 'AGENTS.md', 'CLAUDE.md', 'package.json', 'tsconfig.json', 'bun.lock', '.releaserc.json', '.gitignore']) {
    const source = join(templateRoot, file);
    const fallback = file === '.releaserc.json' ? join(repoRoot, file) : source;
    if (existsSync(source)) await cp(source, join(destination, file));
    else if (existsSync(fallback)) await cp(fallback, join(destination, file));
  }
}

async function materializeSkillTemplates(destination: string): Promise<void> {
  const skillsRoot = join(destination, 'src', 'skills');
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const templatePath = join(skillsRoot, entry.name, 'SKILL.md.tmpl');
    if (existsSync(templatePath)) {
      await writeFile(join(skillsRoot, entry.name, 'SKILL.md'), await readFile(templatePath, 'utf8'), 'utf8');
      await rm(templatePath);
    }
  }
}

async function writeDestinationPackage(destination: string, config: NormalizedTemplateConfig): Promise<void> {
  const packagePath = join(destination, 'package.json');
  const fallbackScripts = Object.fromEntries(['build', 'check', 'validate', 'install', 'update', 'uninstall', 'versions', 'doctor', 'sync-project', 'sync-docs', 'migrate', 'package', 'release:preview', 'release:prepare'].map(command => [command, `bun run cli/index.ts ${command}`]));
  const packageJson = existsSync(packagePath) ? JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown> : { private: true, type: 'module', scripts: fallbackScripts };
  packageJson.name = config.packageName;
  packageJson.version = config.version;
  packageJson.private = true;
  packageJson.packageManager = 'bun@1.3.14';
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  const lockPath = join(destination, 'bun.lock');
  if (existsSync(lockPath)) {
    const lock = await readFile(lockPath, 'utf8');
    const updated = lock.replace(/("workspaces"\s*:\s*\{[\s\S]*?""\s*:\s*\{[\s\S]*?"name"\s*:\s*)"[^"]+"/, `$1${JSON.stringify(config.packageName)}`);
    if (updated === lock) throw new Error('Unable to update the generated bun.lock workspace name');
    await writeFile(lockPath, updated, 'utf8');
  }
}

async function init(destination: string): Promise<void> {
  if (existsSync(destination) && (await readdir(destination)).length) throw new Error(`Destination is not empty: ${destination}`);
  await mkdir(destination, { recursive: true });
  await copyTemplateAssets(destination);
  await materializeSkillTemplates(destination);
  const config = normalizeConfig({ pluginId: 'example-agent-plugin', displayName: 'Example Agent Plugin', description: 'A portable Agent Skills plugin.', authorName: 'GeWuYou', repositoryUrl: 'https://github.com/GeWuYou/example-agent-plugin', packageName: '@gewuyou/example-agent-plugin' });
  await mkdir(join(destination, '.agent-plugin'), { recursive: true });
  await writeFile(join(destination, '.agent-plugin', 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await writeFile(join(destination, '.agent-plugin', 'template-provenance.json'), `${JSON.stringify({ templateVersion: '1.0.0', templateSource: 'GeWuYou/agent-skill-plugin-template', templateResolvedSha: null, generatorVersion: '1.0.0' }, null, 2)}\n`, 'utf8');
  await writeDestinationPackage(destination, config);
}

async function validateTemplate(): Promise<void> {
  const required = ['src/skills/example-skill/SKILL.md.tmpl', 'src/skills/example-skill/agents/openai.yaml', 'src/references', 'src/contracts', 'src/schemas', 'src/tools', 'src/templates', 'tests'];
  for (const path of required) if (!existsSync(join(templateRoot, path))) throw new Error(`Missing template path: ${path}`);
  const skill = await readFile(join(templateRoot, 'src/skills/example-skill/SKILL.md.tmpl'), 'utf8');
  if (!/^---\r?\nname:\s*example-skill/m.test(skill)) throw new Error('Example skill frontmatter is invalid');
  const metadata = await readFile(join(templateRoot, 'src/skills/example-skill/agents/openai.yaml'), 'utf8');
  if (!metadata.includes('$example-skill')) throw new Error('Example Skill metadata must reference $example-skill');
  console.log('template validation passed');
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'init') await init(resolve(process.argv[3] ?? 'agent-plugin'));
  else if (command === 'render') await render(resolve(arg('--project') ?? process.cwd()));
  else if (command === 'validate-template') await validateTemplate();
  else throw new Error('Usage: create-agent-skill-plugin <init|render|validate-template> [path] [--project path]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
