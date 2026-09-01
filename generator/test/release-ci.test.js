import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { templateArtifactName } from '../../ci/package-template.mjs';

test('template CI is Bun first and tag gated', async () => {
  const yaml = await readFile(new URL('../../.gitlab-ci.yml', import.meta.url), 'utf8');
  assert.match(yaml, /image: node:22-bookworm/);
  assert.match(yaml, /curl -fsSL https:\/\/bun\.sh\/install \| bash -s -- bun-v1\.3\.14/);
  assert.match(yaml, /export PATH="\$HOME\/\.bun\/bin:\$PATH"/);
  assert.match(yaml, /bun --version/);
  assert.match(yaml, /bun install --frozen-lockfile/);
  const quality = yaml.slice(yaml.indexOf('quality:\n'), yaml.indexOf('package:\n'));
  assert.match(yaml, /bun run test/);
  const order = ['bun install --frozen-lockfile', 'bun run typecheck', 'bun run build', 'bun run test', 'bun run validate', 'bun run check'].map(command => quality.indexOf(command));
  assert.ok(order.every((index, position) => index >= 0 && (position === 0 || index > order[position - 1])), 'quality commands must run in dependency order');
  assert.match(yaml, /RELEASE_VERSION=.*CI_COMMIT_TAG/);
  assert.match(yaml, /PLUGIN_VERSION=/);
  assert.match(yaml, /CI_COMMIT_TAG =~/);
});

test('template source archive naming is stable', () => {
  assert.equal(templateArtifactName('1.0.0'), 'agent-foundry-agent-skill-plugin-template-source-1.0.0.tar.gz');
});

test('manual release is protected, stable-only, and ref-bound', async () => {
  const yaml = await readFile(new URL('../../.gitlab-ci.yml', import.meta.url), 'utf8');
  assert.match(yaml, /manual-release:/);
  assert.match(yaml, /CI_PIPELINE_SOURCE == "web"/);
  assert.match(yaml, /CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH/);
  assert.match(yaml, /CI_COMMIT_REF_PROTECTED == "true"/);
  assert.doesNotMatch(yaml, /RELEASE_VERSION =~/);
  assert.match(yaml, /when: manual/);
  assert.match(yaml, /environment:\n\s+name: production/);
  assert.match(yaml, /resource_group: "agent-skill-plugin-template-manual-\$RELEASE_VERSION"/);
  assert.match(yaml, /bun run ci\/manual-release-gitlab\.mjs/);
  const script = await readFile(new URL('../../ci/manual-release-gitlab.mjs', import.meta.url), 'utf8');
  assert.match(script, /stable X\.Y\.Z/);
  assert.match(script, /calculateNextVersion/);
  assert.match(script, /tag', '--merged', 'HEAD'/);
  assert.match(script, /log', '--format=%B'/);
  assert.match(script, /: '0\.1\.0'/);
  assert.match(script, /no releasable commits found/);
  assert.match(script, /CI_COMMIT_BRANCH.*CI_DEFAULT_BRANCH/);
  assert.match(script, /CI_COMMIT_REF_PROTECTED/);
  assert.match(script, /CI_JOB_TOKEN/);
  assert.match(script, /repository\/tags/);
  assert.match(script, /payload\.commit\?\.id !== sha/);
  assert.match(script, /process\.env\.CI_COMMIT_TAG = tag/);
  assert.match(script, /packageTemplate\(\{ version \}\)/);
  assert.match(script, /publish-gitlab\.mjs/);
  assert.doesNotMatch(script, /git\s+(push|commit|tag|checkout|reset)/);
  const publish = await readFile(new URL('../../ci/publish-gitlab.mjs', import.meta.url), 'utf8');
  assert.match(publish, /tag_name: tag/);
  assert.match(publish, /ref: process\.env\.CI_COMMIT_SHA/);
});
