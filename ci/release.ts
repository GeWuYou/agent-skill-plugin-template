import { existsSync } from "node:fs";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import semanticRelease from "semantic-release";
import { runGit } from "./git.ts";

export interface ReleasePreview {
  shouldRelease: boolean;
  lastTag: string;
  nextVersion: string;
  nextTag: string;
  releaseNotes: string;
  triggerSha: string;
}

const RELEASE_PLUGINS: unknown[] = [
  ["@semantic-release/commit-analyzer", {
    preset: "conventionalcommits",
    releaseRules: [
      { breaking: true, release: "major" },
      { revert: true, release: "patch" },
      { type: "feat", release: "minor" },
      { type: "fix", release: "patch" },
      { type: "perf", release: "patch" },
      { type: "refactor", release: "patch" },
      { type: "deps", release: "patch" },
      { type: "security", release: "patch" },
      { type: "docs", release: false },
      { type: "test", release: false },
      { type: "chore", release: false },
      { type: "build", release: false },
      { type: "ci", release: false },
      { type: "style", release: false },
    ],
    parserOpts: { noteKeywords: ["BREAKING CHANGE", "BREAKING CHANGES"] },
  }],
  ["@semantic-release/release-notes-generator", {
    preset: "conventionalcommits",
    parserOpts: { noteKeywords: ["BREAKING CHANGE", "BREAKING CHANGES"] },
  }],
];

async function repositoryUrl(root: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { repository?: string | { url?: string } };
  const value = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  if (!value) throw new Error("package.json repository.url is required for releases");
  return value;
}

function normalizeReleaseNotes(notes: string, configuredRepository: string): string {
  const webRepository = configuredRepository.replace(/^git\+/, "").replace(/\.git$/, "");
  if (!/^https:\/\/github\.com\//i.test(webRepository)) return notes;
  return notes.replace(/https?:\/+[^)\s]+?\/repository(?=\/(?:compare|commit)\/)/g, webRepository);
}

async function requireBaseline(root: string): Promise<void> {
  try {
    await runGit(root, ["rev-parse", "--verify", "refs/tags/v0.0.0^{}"]);
  } catch {
    throw new Error("Missing baseline tag v0.0.0. Create and push it on the GitHub initialization commit before previewing a release.");
  }
}

async function latestVersionTag(root: string): Promise<string> {
  const tags = (await runGit(root, ["tag", "--merged", "HEAD", "--list", "v*", "--sort=-v:refname"]))
    .split(/\r?\n/)
    .filter((tag) => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag));
  return tags[0] ?? "v0.0.0";
}

async function calculate(root: string, dryRun: boolean): Promise<ReleasePreview> {
  await requireBaseline(root);
  const triggerSha = (await runGit(root, ["rev-parse", "HEAD"])).trim();
  const lastTag = await latestVersionTag(root);
  let previewRoot: string | undefined;
  try {
    const configuredRepository = await repositoryUrl(root);
    let releaseRepository = configuredRepository;
    if (dryRun) {
      previewRoot = await mkdtemp(join(tmpdir(), "template-release-preview-"));
      const bare = join(previewRoot, "repository.git");
      await runGit(root, ["clone", "--bare", "--no-local", ".", bare]);
      releaseRepository = pathToFileURL(bare).href;
    }
    const result = await semanticRelease({
      branches: ["main"],
      tagFormat: "v${version}",
      repositoryUrl: releaseRepository,
      plugins: RELEASE_PLUGINS,
      dryRun,
      ci: false,
    }, { cwd: root, env: process.env });
    if (!result) return { shouldRelease: false, lastTag, nextVersion: "", nextTag: "", releaseNotes: "", triggerSha };
    return {
      shouldRelease: true,
      lastTag: result.lastRelease.gitTag || lastTag,
      nextVersion: result.nextRelease.version,
      nextTag: result.nextRelease.gitTag,
      releaseNotes: normalizeReleaseNotes(result.nextRelease.notes, configuredRepository),
      triggerSha,
    };
  } finally {
    if (previewRoot) await rm(previewRoot, { recursive: true, force: true });
  }
}

export async function previewRelease(root: string): Promise<ReleasePreview> {
  return calculate(root, true);
}

export async function prepareRelease(root: string, expected: { sha: string; version: string; tag: string }): Promise<ReleasePreview & { alreadyPublished: boolean }> {
  const head = (await runGit(root, ["rev-parse", "HEAD"])).trim();
  const remoteMain = (await runGit(root, ["rev-parse", "origin/main"])).trim();
  if (head !== expected.sha || head !== remoteMain) throw new Error("main moved after release preview; start a new release run");

  let existingTag: string | undefined;
  try {
    existingTag = (await runGit(root, ["rev-list", "-n", "1", expected.tag])).trim();
  } catch {
    existingTag = undefined;
  }
  if (existingTag) {
    if (existingTag !== head) throw new Error(`${expected.tag} already points to a different commit`);
    return { shouldRelease: true, lastTag: expected.tag, nextVersion: expected.version, nextTag: expected.tag, releaseNotes: "", triggerSha: head, alreadyPublished: true };
  }

  const preview = await calculate(root, true);
  if (!preview.shouldRelease || preview.triggerSha !== expected.sha || preview.nextVersion !== expected.version || preview.nextTag !== expected.tag) {
    throw new Error("Release calculation changed after approval; start a new release run");
  }
  const published = await calculate(root, false);
  if (!published.shouldRelease || published.nextVersion !== expected.version || published.nextTag !== expected.tag) {
    throw new Error("semantic-release did not publish the approved version tag");
  }
  const tagSha = (await runGit(root, ["rev-list", "-n", "1", expected.tag])).trim();
  if (tagSha !== head) throw new Error(`Published tag ${expected.tag} does not point to the approved commit`);
  return { ...published, alreadyPublished: false };
}

export async function writeReleaseOutputs(preview: ReleasePreview, outputPath?: string): Promise<void> {
  await writeFile(resolve("release-preview.json"), `${JSON.stringify(preview, null, 2)}\n`, "utf8");
  if (!outputPath) return;
  const delimiter = `RELEASE_NOTES_${Date.now()}`;
  await appendFile(outputPath, [
    `shouldRelease=${preview.shouldRelease}`,
    `lastTag=${preview.lastTag}`,
    `nextVersion=${preview.nextVersion}`,
    `nextTag=${preview.nextTag}`,
    `triggerSha=${preview.triggerSha}`,
    `releaseNotes<<${delimiter}`,
    preview.releaseNotes,
    delimiter,
    "",
  ].join("\n"), "utf8");
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "preview") {
    const result = await previewRelease(process.cwd());
    await writeReleaseOutputs(result, argument("--github-output") ?? process.env.GITHUB_OUTPUT);
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "prepare") {
    console.log(JSON.stringify(await prepareRelease(process.cwd(), {
      sha: requiredArgument("--expected-sha"),
      version: requiredArgument("--expected-version"),
      tag: requiredArgument("--expected-tag"),
    }), null, 2));
  } else {
    throw new Error("Usage: bun ci/release.ts <preview|prepare>");
  }
}
