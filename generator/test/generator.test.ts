import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'bun:test';
import { normalizeConfig } from '../src/index.js';

const generatorRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(generatorRoot, '..');
const cli = join(generatorRoot, 'src', 'index.ts');

function run(args: string[], cwd = generatorRoot, environment: Record<string, string> = {}): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, ...environment } });
    let output = '';
    child.stdout.on('data', data => { output += String(data); });
    child.stderr.on('data', data => { output += String(data); });
    child.on('close', code => code === 0 ? resolveRun(output) : reject(new Error(output)));
  });
}

async function withProject(runTest: (project: string) => Promise<void>): Promise<void> {
  const project = await mkdtemp(join(tmpdir(), 'agent-skill-plugin-'));
  try {
    await run(['init', project]);
    await runTest(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

describe('template configuration', () => {
  test('applies deterministic metadata defaults and normalizes empty optional values', () => {
    const config = normalizeConfig({
      pluginId: 'example-plugin',
      displayName: 'Example Plugin',
      description: 'Portable skills.',
      authorName: 'GeWuYou',
      authorEmail: ' ',
      authorUrl: '',
      repositoryUrl: 'https://github.com/GeWuYou/example-plugin',
    });
    assert.equal(config.developerName, 'GeWuYou');
    assert.equal(config.shortDescription, 'Portable skills.');
    assert.equal(config.longDescription, 'Portable skills.');
    assert.equal(config.category, 'Development');
    assert.deepEqual(config.capabilities, ['Skills']);
    assert.equal(config.packageName, '@gewuyou/example-plugin');
    assert.deepEqual(config.defaultPrompts, ['Use Example Plugin to help with this task.']);
    assert.equal(config.authorEmail, undefined);
    assert.equal(config.authorUrl, undefined);
    assert.throws(() => normalizeConfig({ pluginId: 'bad', displayName: 'Bad', description: 'Bad.', authorName: 'GeWuYou', repositoryUrl: 'https://example.com', supportedPlatforms: [] }), /supportedPlatforms/);
  });

  test('initializes a Bun and TypeScript project and copies every available template asset', async () => {
    await withProject(async project => {
      const config = JSON.parse(await readFile(join(project, '.agent-plugin', 'config.json'), 'utf8'));
      const packageJson = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
      const provenance = JSON.parse(await readFile(join(project, '.agent-plugin', 'template-provenance.json'), 'utf8'));
      assert.equal(config.packageName, '@gewuyou/example-agent-plugin');
      assert.equal(config.developerName, 'GeWuYou');
      assert.deepEqual(config.defaultPrompts, ['Use Example Agent Plugin to help with this task.']);
      assert.equal(packageJson.name, config.packageName);
      assert.equal(packageJson.packageManager, 'bun@1.3.14');
      assert.equal(provenance.templateSource, 'GeWuYou/agent-skill-plugin-template');
      assert.ok(existsSync(join(project, 'src', 'skills', 'example-skill', 'SKILL.md')));
      assert.ok(!existsSync(join(project, 'src', 'skills', 'example-skill', 'SKILL.md.tmpl')));
      for (const path of ['cli/index.ts', 'cli/build.ts', 'cli/package.ts', 'ci', '.github', 'tsconfig.json', 'bun.lock', '.releaserc.json']) {
        if (existsSync(join(repositoryRoot, 'template', path))) assert.ok(existsSync(join(project, path)), `init did not copy template/${path}`);
      }
      if (existsSync(join(project, 'bun.lock'))) assert.match(await readFile(join(project, 'bun.lock'), 'utf8'), /"name": "@gewuyou\/example-agent-plugin"/);
      for (const command of ['package', 'release:preview', 'release:prepare']) assert.ok(packageJson.scripts[command], `missing ${command}`);
      for (const command of Object.values(packageJson.scripts) as string[]) assert.doesNotMatch(command, /(?:^|\s)node(?:\s|$)/);
    });
  });
});

describe('platform generation', () => {
  test('copies complete Skill directories and rewrites non-Claude names and invocation metadata', async () => {
    await withProject(async project => {
      await run(['render', '--project', project]);
      const config = JSON.parse(await readFile(join(project, '.agent-plugin', 'config.json'), 'utf8'));
      const expected = [
        ['claude', join(project, 'plugins', 'claude', config.pluginId, 'skills', 'example-skill'), 'example-skill'],
        ['codex', join(project, 'plugins', 'codex', config.pluginId, 'skills', `${config.defaultSkillPrefix}example-skill`), `${config.defaultSkillPrefix}example-skill`],
        ['universal', join(project, 'plugins', 'universal', '.agents', 'skills', `${config.defaultSkillPrefix}example-skill`), `${config.defaultSkillPrefix}example-skill`],
      ] as const;
      for (const [, skillRoot, skillName] of expected) {
        for (const resource of ['SKILL.md', 'agents/openai.yaml', 'scripts/example.ts', 'references/usage.md', 'assets/icon.svg']) assert.ok(existsSync(join(skillRoot, resource)), `missing ${resource}`);
        assert.match(await readFile(join(skillRoot, 'SKILL.md'), 'utf8'), new RegExp(`^name: ${skillName}$`, 'm'));
        assert.match(await readFile(join(skillRoot, 'agents', 'openai.yaml'), 'utf8'), new RegExp(`\\$${skillName.replaceAll('-', '\\-')}`));
      }
    });
  });

  test('renders complete Codex metadata and canonical marketplace source objects', async () => {
    await withProject(async project => {
      const configPath = join(project, '.agent-plugin', 'config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      Object.assign(config, {
        authorEmail: '',
        authorUrl: 'https://github.com/GeWuYou',
        shortDescription: 'Short plugin description',
        longDescription: 'Long plugin description for the details page.',
        developerName: 'GeWuYou Studio',
        category: 'Productivity',
        capabilities: ['Skills', 'Write'],
        defaultPrompts: ['Use this plugin to review a skill.'],
        brandColor: '#3B82F6',
      });
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
      await run(['render', '--project', project]);
      const manifest = JSON.parse(await readFile(join(project, 'plugins', 'codex', config.pluginId, '.codex-plugin', 'plugin.json'), 'utf8'));
      assert.deepEqual(manifest.author, { name: config.authorName, url: config.authorUrl });
      assert.deepEqual(manifest.interface, {
        displayName: config.displayName,
        shortDescription: config.shortDescription,
        longDescription: config.longDescription,
        developerName: config.developerName,
        category: config.category,
        capabilities: config.capabilities,
        websiteURL: config.homepageUrl,
        defaultPrompt: config.defaultPrompts,
        brandColor: config.brandColor,
      });
      const marketplace = JSON.parse(await readFile(join(project, 'marketplaces', 'codex', '.agents', 'plugins', 'marketplace.json'), 'utf8'));
      assert.equal(marketplace.interface.displayName, config.displayName);
      assert.deepEqual(marketplace.plugins[0].source, { source: 'local', path: `./plugins/${config.pluginId}` });
      assert.deepEqual(marketplace.plugins[0].policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
      assert.equal(marketplace.plugins[0].category, 'Productivity');
      const rootMarketplace = JSON.parse(await readFile(join(project, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
      assert.deepEqual(rootMarketplace.plugins[0].source, { source: 'local', path: `./plugins/codex/${config.pluginId}` });
    });
  });

  test('uses PLUGIN_VERSION consistently without mutating configuration', async () => {
    await withProject(async project => {
      const configPath = join(project, '.agent-plugin', 'config.json');
      const before = await readFile(configPath, 'utf8');
      await run(['render', '--project', project], generatorRoot, { PLUGIN_VERSION: '2.0.0' });
      const config = JSON.parse(before);
      const manifest = JSON.parse(await readFile(join(project, 'plugins', 'codex', config.pluginId, '.codex-plugin', 'plugin.json'), 'utf8'));
      const provenance = JSON.parse(await readFile(join(project, 'plugins', 'universal', '.agent-plugin', 'provenance.json'), 'utf8'));
      assert.equal(manifest.version, '2.0.0');
      assert.equal(provenance.packageVersion, '2.0.0');
      assert.equal(await readFile(configPath, 'utf8'), before);
    });
  });
});

test('validate-template accepts the canonical scaffold', async () => {
  assert.match(await run(['validate-template']), /passed/);
});
