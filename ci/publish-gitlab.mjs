import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const tag = process.env.CI_COMMIT_TAG ?? '';
const api = process.env.CI_API_V4_URL; const project = process.env.CI_PROJECT_ID; const token = process.env.CI_JOB_TOKEN;
if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-beta\.[1-9]\d*)?$/.test(tag)) throw new Error('publish requires a protected SemVer tag');
if (!api || !project || !token) throw new Error('CI_API_V4_URL, CI_PROJECT_ID and CI_JOB_TOKEN are required');
if (process.env.CI_COMMIT_REF_PROTECTED !== 'true') throw new Error('refusing to publish from an unprotected tag');
const version = tag.slice(1); const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, 'dist', 'release', 'release-manifest.json'), 'utf8'));
if (manifest.packageVersion !== version) throw new Error('release manifest does not match CI tag');
const packageName = process.env.CI_PROJECT_NAME ?? manifest.packageId; const headers = { 'JOB-TOKEN': token, 'Content-Type': 'application/octet-stream' };
for (const artifact of manifest.artifacts) {
  const body = await readFile(join(root, 'dist', 'release', artifact.name));
  if (createHash('sha256').update(body).digest('hex') !== artifact.sha256) throw new Error(`checksum mismatch: ${artifact.name}`);
  const url = `${api}/projects/${encodeURIComponent(project)}/packages/generic/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}/${encodeURIComponent(artifact.name)}`;
  const response = await fetch(url, { method: 'PUT', headers, body });
  if (!response.ok) throw new Error(`registry upload failed (${response.status})`);
}
const releaseUrl = `${api}/projects/${encodeURIComponent(project)}/releases`;
const release = await fetch(releaseUrl, { method: 'POST', headers: { 'JOB-TOKEN': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tag, tag_name: tag, ref: process.env.CI_COMMIT_SHA, description: `Template ${version}` }) });
if (!release.ok) {
  if (release.status !== 409) throw new Error(`GitLab Release creation failed (${release.status})`);
  const existing = await fetch(`${releaseUrl}/${encodeURIComponent(tag)}`, { headers: { 'JOB-TOKEN': token } });
  if (!existing.ok || (await existing.json()).tag_name !== tag) throw new Error('GitLab Release conflict could not be verified');
}
console.log(`published template ${tag}`);
