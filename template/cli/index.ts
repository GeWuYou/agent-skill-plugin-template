#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildArtifacts } from "./build.ts";
import { PLATFORMS, readConfig } from "./config.ts";
import { installProject, uninstallProject } from "./install.ts";
import { packageRelease } from "./package.ts";
import { prepareRelease, previewRelease, writeReleaseOutputs } from "./release.ts";
import { assertPlatform, checkProject, validateProject } from "./validate.ts";

const root = process.cwd();
const command = process.argv[2] ?? "help";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

async function doctor(): Promise<void> {
  const configPath = resolve(root, ".agent-plugin", "config.json");
  if (!existsSync(configPath)) throw new Error("Missing .agent-plugin/config.json");
  const config = await readConfig(root);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(config.pluginId)) throw new Error("pluginId must be lowercase kebab-case");
  if (!config.supportedPlatforms.length || config.supportedPlatforms.some((platform) => !PLATFORMS.includes(platform))) {
    throw new Error("At least one supported platform is required");
  }
  if (Bun.version !== "1.3.14") throw new Error(`Expected Bun 1.3.14, found ${Bun.version}`);
  console.log(`doctor ok: ${config.pluginId}`);
}

async function main(): Promise<void> {
  if (command === "build") {
    const { canonicalDigest, config } = await buildArtifacts(root);
    console.log(`Rendered ${config.supportedPlatforms.join(", ")} artifacts (${canonicalDigest})`);
    return;
  }
  if (command === "validate") {
    await validateProject(root);
    console.log("validation passed");
    return;
  }
  if (command === "check") {
    await checkProject(root);
    console.log("check passed");
    return;
  }
  if (command === "install" || command === "update") {
    if (command === "install" && !argument("--target")) {
      console.log("Dependency installation detected; plugin installation requires an explicit --target path");
      return;
    }
    const platformValue = argument("--ai") ?? "universal";
    assertPlatform(platformValue);
    await installProject(root, resolve(requiredArgument("--target")), platformValue, command);
    return;
  }
  if (command === "uninstall") {
    await uninstallProject(resolve(argument("--target") ?? root));
    return;
  }
  if (command === "versions") {
    const config = await readConfig(root);
    console.log(JSON.stringify({ packageVersion: config.version, templateVersion: "1.0.0", bunVersion: Bun.version }, null, 2));
    return;
  }
  if (command === "doctor") {
    await doctor();
    return;
  }
  if (["sync-project", "sync-docs", "migrate"].includes(command)) {
    console.log(`${command}: no project-specific changes configured`);
    return;
  }
  if (command === "package") {
    const result = await packageRelease(root, argument("--version"));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "release:preview") {
    const preview = await previewRelease(root);
    await writeReleaseOutputs(preview, argument("--github-output") ?? process.env.GITHUB_OUTPUT);
    console.log(JSON.stringify(preview, null, 2));
    return;
  }
  if (command === "release:prepare") {
    const result = await prepareRelease(root, {
      sha: requiredArgument("--expected-sha"),
      version: requiredArgument("--expected-version"),
      tag: requiredArgument("--expected-tag"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log([
    "Usage: bun cli/index.ts <command> [options]",
    "Commands:",
    "  build | check | validate | install | update | uninstall | versions | doctor",
    "  sync-project | sync-docs | migrate | package | release:preview | release:prepare",
  ].join("\n"));
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
