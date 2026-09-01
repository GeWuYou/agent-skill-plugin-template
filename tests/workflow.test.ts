import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const root = resolve(import.meta.dir, "..");

describe("GitHub workflows", () => {
  test("quality uses the required serial Bun chain", async () => {
    const body = await readFile(resolve(root, ".github", "workflows", "quality.yml"), "utf8");
    const workflow = parse(body);
    const steps = workflow.jobs.quality.steps;
    expect(steps.find((step: Record<string, unknown>) => step.uses === "actions/checkout@v7")).toBeTruthy();
    expect(steps.find((step: Record<string, unknown>) => step.uses === "oven-sh/setup-bun@v2")?.with["bun-version"]).toBe("1.3.14");
    const commands = steps.map((step: Record<string, unknown>) => step.run).filter(Boolean).join("\n");
    for (const command of ["bun install --frozen-lockfile", "bun run typecheck", "bun run build", "bun test generator/test template/tests tests", "bun run validate", "bun run check"]) {
      expect(commands).toContain(command);
    }
  });

  test("release has no version input and separates preview from protected publish", async () => {
    const body = await readFile(resolve(root, ".github", "workflows", "release.yml"), "utf8");
    const workflow = parse(body);
    expect(workflow.on.workflow_dispatch).toBeNull();
    expect(workflow.jobs.preview.permissions ?? workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.publish.environment).toBe("release");
    expect(workflow.jobs.publish.permissions.contents).toBe("write");
    const previewCheckout = workflow.jobs.preview.steps.find((step: Record<string, unknown>) => step.uses === "actions/checkout@v7");
    const publishCheckout = workflow.jobs.publish.steps.find((step: Record<string, unknown>) => step.uses === "actions/checkout@v7");
    expect(previewCheckout.with.ref).toBe("main");
    expect(publishCheckout.with.ref).toBe("main");
    const previewCommands = workflow.jobs.preview.steps.map((step: Record<string, unknown>) => step.run).filter(Boolean).join("\n");
    const publishCommands = workflow.jobs.publish.steps.map((step: Record<string, unknown>) => step.run).filter(Boolean).join("\n");
    expect(previewCommands).toContain('test "$(git rev-parse HEAD)" = "$DISPATCH_SHA"');
    expect(publishCommands).toContain('test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"');
    expect(body).toContain("release:preview");
    expect(body).toContain("release:prepare");
    expect(body).not.toMatch(/PAT_TOKEN|npm publish|pr-agent/i);

    const generatedBody = await readFile(resolve(root, "template", ".github", "workflows", "release.yml"), "utf8");
    const generatedWorkflow = parse(generatedBody);
    const generatedPreviewCheckout = generatedWorkflow.jobs.preview.steps.find((step: Record<string, unknown>) => step.uses === "actions/checkout@v7");
    const generatedPublishCheckout = generatedWorkflow.jobs.publish.steps.find((step: Record<string, unknown>) => step.uses === "actions/checkout@v7");
    expect(generatedPreviewCheckout.with.ref).toBe("main");
    expect(generatedPublishCheckout.with.ref).toBe("main");
    expect(generatedBody).toContain('test "$(git rev-parse HEAD)" = "$DISPATCH_SHA"');
    expect(generatedBody).toContain('test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"');
  });

  test("root and generated-project workflows are structurally valid", async () => {
    for (const path of [
      resolve(root, ".github", "workflows", "quality.yml"),
      resolve(root, ".github", "workflows", "release.yml"),
      resolve(root, "template", ".github", "workflows", "quality.yml"),
      resolve(root, "template", ".github", "workflows", "release.yml"),
    ]) {
      const workflow = parse(await readFile(path, "utf8"));
      expect(workflow.on).toBeTruthy();
      expect(workflow.jobs).toBeTruthy();
    }
  });

  test("generator initialization copies the generated-project gitignore", async () => {
    const destination = await mkdtemp(join(tmpdir(), "generated-template-gitignore-"));
    await rm(destination, { recursive: true, force: true });
    try {
      const child = Bun.spawn([process.execPath, resolve(root, "generator", "src", "index.ts"), "init", destination], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error(stderr);
      const ignore = await readFile(resolve(destination, ".gitignore"), "utf8");
      for (const entry of ["node_modules/", "dist/", "release/", "release-preview.json"]) expect(ignore).toContain(entry);
      expect(ignore).not.toContain("plugins/");
      expect(ignore).not.toContain("marketplaces/");
    } finally {
      await rm(destination, { recursive: true, force: true });
    }
  });
});
