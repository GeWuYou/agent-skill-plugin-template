import { execFileSync } from 'node:child_process';
import { packageTemplate } from './package-template.mjs';

const stableSemVer = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const api = process.env.CI_API_V4_URL;
const project = process.env.CI_PROJECT_ID;
const token = process.env.CI_JOB_TOKEN;
const sha = process.env.CI_COMMIT_SHA;

function git(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }

async function resolveVersion() {
  const explicit = process.env.RELEASE_VERSION?.trim();
  if (explicit) {
    if (!stableSemVer.test(explicit)) throw new Error('manual release requires RELEASE_VERSION as stable X.Y.Z');
    return explicit;
  }
  execFileSync('bun', ['run', 'build'], { stdio: 'inherit' });
  const { calculateNextVersion, formatVersion, parseTag, compareVersions } = await import('../generator/dist/version.js');
  const tags = git(['tag', '--merged', 'HEAD', '--list', 'v*']).split(/\r?\n/).filter(Boolean);
  const stableTags = tags.filter((value) => { try { return parseTag(value).beta === undefined; } catch { return false; } }).sort(compareVersions);
  const previousStableTag = stableTags.at(-1) ?? null;
  const baseVersion = previousStableTag ? formatVersion(parseTag(previousStableTag)) : '0.1.0';
  const range = previousStableTag ? `${previousStableTag}..HEAD` : 'HEAD';
  const commits = git(['log', '--format=%B', range]).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const result = calculateNextVersion({ baseVersion, previousStableTag, commits, existingTags: tags, channel: 'stable' });
  if (!result.version || !stableSemVer.test(result.version)) throw new Error('no releasable commits found for automatic release');
  return result.version;
}

if (!process.env.CI_COMMIT_BRANCH || process.env.CI_COMMIT_BRANCH !== process.env.CI_DEFAULT_BRANCH) throw new Error('manual release requires the default branch');
if (process.env.CI_COMMIT_REF_PROTECTED !== 'true') throw new Error('manual release requires a protected ref');
if (!api || !project || !token || !sha) throw new Error('CI_API_V4_URL, CI_PROJECT_ID, CI_JOB_TOKEN and CI_COMMIT_SHA are required');

const version = await resolveVersion();
const tag = `v${version}`;
const headers = { 'JOB-TOKEN': token, Accept: 'application/json' };
const tagUrl = `${api}/projects/${encodeURIComponent(project)}/repository/tags/${encodeURIComponent(tag)}`;
const existingTag = await fetch(tagUrl, { headers });
if (existingTag.ok) {
  const payload = await existingTag.json();
  if (payload.commit?.id !== sha) throw new Error(`release tag ${tag} already points to a different commit`);
} else if (existingTag.status !== 404) throw new Error(`could not verify release tag (${existingTag.status})`);

process.env.PLUGIN_VERSION = version;
process.env.CI_COMMIT_TAG = tag;
await packageTemplate({ version });
// Import only after all preflight checks. The publish script posts a Release
// with tag_name=tag and ref=CI_COMMIT_SHA, allowing GitLab to create the tag.
await import('./publish-gitlab.mjs');
