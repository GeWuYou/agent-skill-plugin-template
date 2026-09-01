import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
export function templateArtifactName(version) { return `agent-foundry-agent-skill-plugin-template-source-${version}.tar.gz`; }
function sha256(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
export async function packageTemplate({ version, outputDir = join(root, 'dist', 'release') } = {}) {
  version ??= process.env.RELEASE_VERSION ?? JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/.test(version) || version.split(/[.-]/).slice(0, 3).some((part) => part.length > 1 && part.startsWith('0'))) throw new Error(`invalid release version: ${version}`);
  await mkdir(outputDir, { recursive: true });
  const name = templateArtifactName(version); const target = join(outputDir, name);
  const input = ['-czf', target, '-C', root, 'template', 'generator', 'package.json', '.releaserc.json'];
  try { execFileSync('tar', ['--sort=name', '--mtime=UTC 1970-01-01', '--owner=0', '--group=0', '--numeric-owner', ...input], { stdio: 'ignore' }); }
  catch { execFileSync('tar', input, { stdio: 'inherit' }); }
  const digest = sha256(target); const sourceSha = process.env.CI_COMMIT_SHA ?? null;
  const manifest = { packageId: 'agent-foundry-plugin-template', packageVersion: version, sourceSha, artifacts: [{ name, platform: 'source', sha256: digest, size: statSync(target).size }] };
  await writeFile(join(outputDir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(outputDir, `checksums-${version}.sha256`), `${digest}  ${name}\n`);
  await writeFile(join(outputDir, `provenance-${version}.json`), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (process.argv[1]?.endsWith('package-template.mjs')) packageTemplate().then(m => console.log(JSON.stringify(m, null, 2))).catch(e => { console.error(e.message); process.exitCode = 1; });
