import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildArtifacts } from "../cli/build.ts";
import { packageRelease } from "../cli/package.ts";
import { sha256File } from "../cli/fs.ts";
import { checkProject, validateProject } from "../cli/validate.ts";
import { prepareRelease, previewRelease } from "../cli/release.ts";
import { installProject, uninstallProject } from "../cli/install.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-skill-plugin-"));
  temporaryRoots.push(root);
  await mkdir(join(root, ".agent-plugin"), { recursive: true });
  await mkdir(join(root, "src", "skills", "example-skill", "agents"), { recursive: true });
  await mkdir(join(root, "src", "skills", "example-skill", "assets"), { recursive: true });
  await writeFile(join(root, ".agent-plugin", "config.json"), `${JSON.stringify({
    pluginId: "example-agent-plugin",
    displayName: "Example Agent Plugin",
    description: "A portable Agent Skills plugin for repeatable examples.",
    authorName: "GeWuYou",
    repositoryUrl: "https://github.com/example/example-agent-plugin",
    defaultPrompts: ["Use the plugin to complete the task."],
  }, null, 2)}\n`);
  await writeFile(join(root, "src", "skills", "example-skill", "SKILL.md"), [
    "---",
    "name: example-skill",
    "description: Complete a focused example workflow.",
    "---",
    "",
    "Invoke $example-skill when this workflow applies.",
    "",
  ].join("\n"));
  await writeFile(join(root, "src", "skills", "example-skill", "agents", "openai.yaml"), [
    "interface:",
    "  display_name: \"Example Skill\"",
    "  short_description: \"Complete a focused example workflow\"",
    "  default_prompt: \"Use $example-skill to complete this example.\"",
    "",
  ].join("\n"));
  await writeFile(join(root, "src", "skills", "example-skill", "assets", "fixture.txt"), "fixture\n");
  for (const file of ["README.md", "CHANGELOG.md", "AGENTS.md", "CLAUDE.md", "LICENSE"]) {
    await writeFile(join(root, file), `${file}\n`);
  }
  return root;
}

async function git(root: string, ...args: string[]): Promise<void> {
  const process = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);
  if (code !== 0) throw new Error(stderr);
}

describe("generated project lifecycle", () => {
  test("copies complete Skill directories and rewrites platform names", async () => {
    const root = await fixture();
    await buildArtifacts(root);
    const codexSkill = join(root, "plugins", "codex", "example-agent-plugin", "skills", "example-agent-plugin-example-skill");
    expect(await readFile(join(codexSkill, "assets", "fixture.txt"), "utf8")).toBe("fixture\n");
    expect(await readFile(join(codexSkill, "SKILL.md"), "utf8")).toContain("name: example-agent-plugin-example-skill");
    expect(await readFile(join(codexSkill, "agents", "openai.yaml"), "utf8")).toContain("$example-agent-plugin-example-skill");

    const manifest = JSON.parse(await readFile(join(root, "plugins", "codex", "example-agent-plugin", ".codex-plugin", "plugin.json"), "utf8"));
    expect(manifest.interface.developerName).toBe("GeWuYou");
    expect(manifest.interface.category).toBe("Development");
    expect(manifest.interface.capabilities).toEqual(["Skills"]);
    expect(manifest.interface.defaultPrompt).toEqual(["Use the plugin to complete the task."]);
    const marketplace = JSON.parse(await readFile(join(root, ".agents", "plugins", "marketplace.json"), "utf8"));
    expect(marketplace.interface.displayName).toBe("Example Agent Plugin");
    expect(marketplace.plugins[0].source).toEqual({ source: "local", path: "./plugins/codex/example-agent-plugin" });
    await validateProject(root);
    await checkProject(root);
  });

  test("uses GeWuYou package defaults and repairs empty capabilities", async () => {
    const root = await fixture();
    const configPath = join(root, ".agent-plugin", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.pluginId = "gewuyou-example-plugin";
    config.capabilities = [];
    delete config.packageName;
    delete config.packageSlug;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const { config: resolved } = await buildArtifacts(root);
    expect(resolved.packageSlug).toBe("example-plugin");
    expect(resolved.packageName).toBe("@gewuyou/example-plugin");
    expect(resolved.capabilities).toEqual(["Skills"]);
  });

  test("creates deterministic bundle, checksums, and provenance", async () => {
    const root = await fixture();
    const first = await packageRelease(root, "1.2.3");
    const firstDigest = await sha256File(first.bundle);
    const firstChecksums = await readFile(first.checksums, "utf8");
    const second = await packageRelease(root, "1.2.3");
    expect(await sha256File(second.bundle)).toBe(firstDigest);
    expect(await readFile(second.checksums, "utf8")).toBe(firstChecksums);
    expect(JSON.parse(await readFile(second.provenance, "utf8")).version).toBe("1.2.3");
  });

  test("protects modified files in a managed installation", async () => {
    const root = await fixture();
    const target = await mkdtemp(join(tmpdir(), "agent-skill-install-"));
    temporaryRoots.push(target);
    await installProject(root, target, "universal", "install");
    const installed = join(target, ".agents", "skills", "example-agent-plugin-example-skill", "SKILL.md");
    expect(await readFile(installed, "utf8")).toContain("name: example-agent-plugin-example-skill");
    await writeFile(installed, "locally modified\n");
    expect(uninstallProject(target)).rejects.toThrow("Refusing to remove modified files");
  });

  test("release policy uses the agreed Conventional Commit rules", async () => {
    const releaseConfig = JSON.parse(await readFile(resolve(import.meta.dir, "..", ".releaserc.json"), "utf8"));
    const rules = releaseConfig.plugins[0][1].releaseRules;
    expect(rules.find((rule: Record<string, unknown>) => rule.type === "feat")?.release).toBe("minor");
    expect(rules.find((rule: Record<string, unknown>) => rule.type === "security")?.release).toBe("patch");
    expect(rules.find((rule: Record<string, unknown>) => rule.type === "docs")?.release).toBe(false);
    expect(rules.find((rule: Record<string, unknown>) => rule.breaking)?.release).toBe("major");
  });

  test("fails closed when the v0.0.0 baseline is missing", async () => {
    const root = await fixture();
    await git(root, "init", "--initial-branch=main");
    await git(root, "config", "user.name", "Template Test");
    await git(root, "config", "user.email", "template@example.invalid");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "feat: plugin without baseline");
    expect(previewRelease(root)).rejects.toThrow("Missing baseline tag v0.0.0");
  });

  test("normalizes preview note links to the configured GitHub repository", async () => {
    const root = await fixture();
    await git(root, "init", "--initial-branch=main");
    await git(root, "config", "user.name", "Template Test");
    await git(root, "config", "user.email", "template@example.invalid");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore: initialize template");
    await git(root, "tag", "v0.0.0");
    await writeFile(join(root, "feature.txt"), "feature\n");
    await git(root, "add", "feature.txt");
    await git(root, "commit", "-m", "feat: add a generated feature");
    const preview = await previewRelease(root);
    expect(preview.releaseNotes).toContain("https://github.com/example/example-agent-plugin");
    expect(preview.releaseNotes).not.toMatch(/file:|AppData|semantic-release-preview/i);
  }, 30_000);

  test("calculates the first breaking release from the required baseline", async () => {
    const root = await fixture();
    const remote = await mkdtemp(join(tmpdir(), "agent-skill-plugin-remote-"));
    temporaryRoots.push(remote);
    await git(root, "init", "--initial-branch=main");
    await git(root, "config", "user.name", "Template Test");
    await git(root, "config", "user.email", "template@example.invalid");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "chore: initialize template");
    await git(root, "tag", "v0.0.0");
    await git(remote, "init", "--bare");
    await git(root, "remote", "add", "origin", remote);
    await git(root, "push", "--set-upstream", "origin", "main", "--tags");
    await git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
    const configPath = join(root, ".agent-plugin", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.repositoryUrl = pathToFileURL(remote).href;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(join(root, "breaking.txt"), "breaking\n");
    await git(root, "add", "breaking.txt", ".agent-plugin/config.json");
    await git(root, "commit", "-m", "feat!: migrate plugin template");
    await git(root, "push", "origin", "main");
    const preview = await previewRelease(root);
    expect(preview.lastTag).toBe("v0.0.0");
    expect(preview.nextVersion).toBe("1.0.0");
    expect(preview.nextTag).toBe("v1.0.0");
    expect(preview.shouldRelease).toBe(true);
    const published = await prepareRelease(root, { sha: preview.triggerSha, version: preview.nextVersion, tag: preview.nextTag });
    expect(published.alreadyPublished).toBe(false);
    const rerun = await prepareRelease(root, { sha: preview.triggerSha, version: preview.nextVersion, tag: preview.nextTag });
    expect(rerun.alreadyPublished).toBe(true);
  }, 30_000);
});
