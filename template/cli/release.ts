import { existsSync } from "node:fs";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "bun";
import semanticRelease from "semantic-release";
import { readConfig } from "./config.ts";

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

export async function runGit(root: string, args: string[]): Promise<string> {
  const process = spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (code !== 0) throw new Error(stderr.trim() || `git ${args.join(" ")} failed (${code})`);
  return stdout.trim();
}

async function requireBaseline(root: string): Promise<void> {
  try {
    await runGit(root, ["rev-parse", "--verify", "refs/tags/v0.0.0^{}"]);
  } catch {
    throw new Error("Missing baseline tag v0.0.0. Create and push it on the initialization commit before previewing a release.");
  }
}

function normalizeReleaseNotes(notes: string, configuredRepository: string): string {
  const webRepository = configuredRepository.replace(/^git\+/, "").replace(/\.git$/, "");
  if (!/^https:\/\/github\.com\//i.test(webRepository)) return notes;
  return notes.replace(/https?:\/+[^)\s]+?\/repository(?=\/(?:compare|commit)\/)/g, webRepository);
}

async function latestVersionTag(root: string): Promise<string> {
  const tags = (await runGit(root, ["tag", "--merged", "HEAD", "--list", "v*", "--sort=-v:refname"]))
    .split(/\r?\n/)
    .filter((tag) => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag));
  return tags[0] ?? "v0.0.0";
}

async function calculate(root: string, dryRun: boolean): Promise<ReleasePreview> {
  await requireBaseline(root);
  const config = await readConfig(root);
  const triggerSha = await runGit(root, ["rev-parse", "HEAD"]);
  const lastTag = await latestVersionTag(root);
  let previewRemote: string | undefined;
  try {
    if (dryRun) {
      const previewRoot = await mkdtemp(join(tmpdir(), "semantic-release-preview-"));
      previewRemote = join(previewRoot, "repository.git");
      await runGit(root, ["clone", "--bare", "--no-local", ".", previewRemote]);
    }
    const result = await semanticRelease({
      branches: ["main"],
      tagFormat: "v${version}",
      repositoryUrl: previewRemote ? pathToFileURL(previewRemote).href : config.repositoryUrl,
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
      releaseNotes: normalizeReleaseNotes(result.nextRelease.notes, config.repositoryUrl),
      triggerSha,
    };
  } finally {
    if (previewRemote) await rm(resolve(previewRemote, ".."), { recursive: true, force: true });
  }
}

export async function previewRelease(root: string): Promise<ReleasePreview> {
  return calculate(root, true);
}

export async function prepareRelease(root: string, expected: { sha: string; version: string; tag: string }): Promise<ReleasePreview & { alreadyPublished: boolean }> {
  const head = await runGit(root, ["rev-parse", "HEAD"]);
  const remoteMain = await runGit(root, ["rev-parse", "origin/main"]);
  if (head !== expected.sha || head !== remoteMain) throw new Error("main moved after release preview; start a new release run");

  let existingTag: string | undefined;
  try {
    existingTag = await runGit(root, ["rev-list", "-n", "1", expected.tag]);
  } catch {
    existingTag = undefined;
  }
  if (existingTag) {
    if (existingTag !== head) throw new Error(`${expected.tag} already points to a different commit`);
    return {
      shouldRelease: true,
      lastTag: expected.tag,
      nextVersion: expected.version,
      nextTag: expected.tag,
      releaseNotes: "",
      triggerSha: head,
      alreadyPublished: true,
    };
  }

  const preview = await calculate(root, true);
  if (!preview.shouldRelease || preview.nextVersion !== expected.version || preview.nextTag !== expected.tag || preview.triggerSha !== expected.sha) {
    throw new Error("Release calculation changed after approval; start a new release run");
  }

  const published = await calculate(root, false);
  if (!published.shouldRelease || published.nextVersion !== expected.version || published.nextTag !== expected.tag) {
    throw new Error("semantic-release did not publish the approved version tag");
  }
  const tagSha = await runGit(root, ["rev-list", "-n", "1", expected.tag]);
  if (tagSha !== head) throw new Error(`Published tag ${expected.tag} does not point to the approved commit`);
  return { ...published, alreadyPublished: false };
}

export async function writeReleaseOutputs(preview: ReleasePreview, outputPath?: string): Promise<void> {
  const payload = `${JSON.stringify(preview, null, 2)}\n`;
  const resultPath = resolve("release-preview.json");
  await writeFile(resultPath, payload, "utf8");
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

export async function readReleasePreview(path = join(process.cwd(), "release-preview.json")): Promise<ReleasePreview> {
  if (!existsSync(path)) throw new Error(`Missing release preview: ${path}`);
  return JSON.parse(await readFile(path, "utf8")) as ReleasePreview;
}
