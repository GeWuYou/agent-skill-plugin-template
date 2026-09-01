import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { packageTemplate } from "../ci/package.ts";
import { prepareRelease, previewRelease } from "../ci/release.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function git(root: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(stderr);
  return stdout.trim();
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "template-release-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "@gewuyou/agent-skill-plugin-template",
    version: "0.0.0",
    repository: { url: "https://github.com/GeWuYou/agent-skill-plugin-template.git" },
  }, null, 2)}\n`);
  await writeFile(join(root, "src", "fixture.ts"), "export const fixture = true;\n");
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.name", "Release Test");
  await git(root, "config", "user.email", "release@example.invalid");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "chore: initialize template");
  return root;
}

function sha256(path: string): Promise<string> {
  return readFile(path).then((body) => createHash("sha256").update(body).digest("hex"));
}

async function withPullRequestEnvironment<T>(task: () => Promise<T>): Promise<T> {
  const keys = ["GITHUB_ACTIONS", "GITHUB_REF", "GITHUB_HEAD_REF", "GITHUB_BASE_REF", "GITHUB_EVENT_NAME"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GITHUB_ACTIONS: "true",
    GITHUB_REF: "refs/pull/1/merge",
    GITHUB_HEAD_REF: "codex/github-ts-migration",
    GITHUB_BASE_REF: "main",
    GITHUB_EVENT_NAME: "pull_request",
  });
  try {
    return await task();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("root release lifecycle", () => {
  test("packages the tracked Git tree deterministically", async () => {
    const root = await repository();
    await git(root, "tag", "v1.2.3");
    const first = await packageTemplate(root, "1.2.3");
    const digest = await sha256(first.bundle);
    const checksums = await readFile(first.checksums, "utf8");
    const second = await packageTemplate(root, "1.2.3");
    expect(await sha256(second.bundle)).toBe(digest);
    expect(await readFile(second.checksums, "utf8")).toBe(checksums);
    expect(first.bundle.endsWith("gewuyou-agent-skill-plugin-template-source-1.2.3.tar.gz")).toBe(true);
  });

  test("refuses packaging when the release tag is missing", async () => {
    const root = await repository();
    expect(packageTemplate(root, "1.2.3")).rejects.toThrow("Required release tag v1.2.3 is missing");
  });

  test("refuses packaging when the release tag points to another commit", async () => {
    const root = await repository();
    await git(root, "tag", "v1.2.3");
    await writeFile(join(root, "src", "second.ts"), "export const second = true;\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "fix: move head after tag");
    expect(packageTemplate(root, "1.2.3")).rejects.toThrow("does not point to HEAD");
  });

  test("refuses packaging a dirty tracked working tree", async () => {
    const root = await repository();
    await git(root, "tag", "v1.2.3");
    await writeFile(join(root, "src", "fixture.ts"), "export const fixture = false;\n");
    expect(packageTemplate(root, "1.2.3")).rejects.toThrow("dirty tracked working tree");
  });

  test("fails release preview without the v0.0.0 baseline", async () => {
    const root = await repository();
    expect(previewRelease(root)).rejects.toThrow("Missing baseline tag v0.0.0");
  });

  test("returns a successful no-op for non-releasable commits", async () => {
    const root = await repository();
    await git(root, "tag", "v0.0.0");
    await writeFile(join(root, "README.md"), "Documentation only.\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-m", "docs: explain the template");
    const preview = await previewRelease(root);
    expect(preview.shouldRelease).toBe(false);
    expect(preview.lastTag).toBe("v0.0.0");
    expect(preview.nextVersion).toBe("");
    expect(preview.nextTag).toBe("");
  }, 30_000);

  test("uses controlled main identity when ambient GitHub context is a pull request", async () => {
    const root = await repository();
    await git(root, "tag", "v0.0.0");
    await writeFile(join(root, "breaking.ts"), "export const migration = true;\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "feat!: migrate the template");

    const preview = await withPullRequestEnvironment(() => previewRelease(root));
    expect(preview.shouldRelease).toBe(true);
    expect(preview.lastTag).toBe("v0.0.0");
    expect(preview.nextVersion).toBe("1.0.0");
    expect(preview.nextTag).toBe("v1.0.0");
  }, 30_000);

  test("calculates, publishes, and safely reuses the first breaking release", async () => {
    const root = await repository();
    await git(root, "tag", "v0.0.0");
    const remote = await mkdtemp(join(tmpdir(), "template-release-remote-"));
    temporaryRoots.push(remote);
    await git(remote, "init", "--bare");
    await git(root, "remote", "add", "origin", remote);
    await git(root, "push", "--set-upstream", "origin", "main", "--tags");
    await git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
    const packagePath = join(root, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    packageJson.repository.url = pathToFileURL(remote).href;
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    await writeFile(join(root, "breaking.ts"), "export const migration = true;\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "feat!: migrate to GitHub and Bun");
    await git(root, "push", "origin", "main");

    const preview = await previewRelease(root);
    expect(preview.lastTag).toBe("v0.0.0");
    expect(preview.nextVersion).toBe("1.0.0");
    expect(preview.nextTag).toBe("v1.0.0");
    const published = await prepareRelease(root, { sha: preview.triggerSha, version: preview.nextVersion, tag: preview.nextTag });
    expect(published.alreadyPublished).toBe(false);
    const rerun = await prepareRelease(root, { sha: preview.triggerSha, version: preview.nextVersion, tag: preview.nextTag });
    expect(rerun.alreadyPublished).toBe(true);
  }, 30_000);
});
