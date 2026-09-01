import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { buildArtifacts } from "./build.ts";
import { PLATFORMS, readConfig } from "./config.ts";
import { hashTree, walkFiles } from "./fs.ts";

const HAND_AUTHORED_JAVASCRIPT = new Set([".js", ".mjs", ".cjs", ".jsx"]);

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
}

async function validateSkill(path: string): Promise<void> {
  const body = await readFile(path, "utf8");
  const name = body.match(/^name:\s*([^\n]+)$/m)?.[1]?.trim();
  const description = body.match(/^description:\s*([^\n]+)$/m)?.[1]?.trim();
  if (!body.startsWith("---\n") || !name || !/^[a-z0-9][a-z0-9-]*$/.test(name) || !description) {
    throw new Error(`Invalid Skill frontmatter: ${path}`);
  }
  const openAiPath = join(path, "..", "agents", "openai.yaml");
  if (!existsSync(openAiPath)) return;
  const metadata = parseYaml(await readFile(openAiPath, "utf8")) as unknown;
  assertRecord(metadata, `Invalid agents/openai.yaml: ${openAiPath}`);
  assertRecord(metadata.interface, `Missing interface in ${openAiPath}`);
  const shortDescription = metadata.interface.short_description;
  const defaultPrompt = metadata.interface.default_prompt;
  if (typeof shortDescription !== "string" || shortDescription.length < 25 || shortDescription.length > 64) {
    throw new Error(`short_description must be 25-64 characters: ${openAiPath}`);
  }
  if (typeof defaultPrompt !== "string" || !defaultPrompt.includes(`$${name}`)) {
    throw new Error(`default_prompt must mention $${name}: ${openAiPath}`);
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  assertRecord(value, `Expected a JSON object: ${path}`);
  return value;
}

export async function validateProject(root: string): Promise<void> {
  const config = await readConfig(root);
  const canonicalSkills = (await walkFiles(join(root, "src", "skills"))).filter((path) => /SKILL\.md(?:\.tmpl)?$/.test(path));
  if (canonicalSkills.length === 0) throw new Error("No canonical Skill found under src/skills");
  for (const path of canonicalSkills) await validateSkill(path);
  if (!existsSync(join(root, "plugins"))) throw new Error("Generated plugins are missing; run bun run build");

  for (const platform of config.supportedPlatforms) {
    const skillsRoot = platform === "universal"
      ? join(root, "plugins", "universal", ".agents", "skills")
      : join(root, "plugins", platform, config.pluginId, "skills");
    const generatedSkills = (await walkFiles(skillsRoot)).filter((path) => path.endsWith("SKILL.md"));
    if (generatedSkills.length !== canonicalSkills.length) throw new Error(`Skill count mismatch for ${platform}`);
    for (const path of generatedSkills) await validateSkill(path);
  }

  if (config.supportedPlatforms.includes("codex")) {
    const manifest = await readJson(join(root, "plugins", "codex", config.pluginId, ".codex-plugin", "plugin.json"));
    assertRecord(manifest.interface, "Codex plugin manifest is missing interface metadata");
    for (const key of ["displayName", "shortDescription", "longDescription", "developerName", "category", "capabilities", "defaultPrompt"]) {
      if (!(key in manifest.interface)) throw new Error(`Codex plugin interface is missing ${key}`);
    }
    if (!Array.isArray(manifest.interface.defaultPrompt) || manifest.interface.defaultPrompt.length === 0) {
      throw new Error("Codex plugin interface defaultPrompt must be a non-empty array");
    }
    const marketplace = await readJson(join(root, ".agents", "plugins", "marketplace.json"));
    assertRecord(marketplace.interface, "Codex marketplace is missing interface metadata");
    const plugins = marketplace.plugins;
    if (!Array.isArray(plugins) || plugins.length !== 1) throw new Error("Codex marketplace must contain exactly one plugin");
    assertRecord(plugins[0], "Invalid Codex marketplace plugin entry");
    assertRecord(plugins[0].source, "Codex marketplace source must be an object");
    if (plugins[0].source.source !== "local" || plugins[0].source.path !== `./plugins/codex/${config.pluginId}`) {
      throw new Error("Codex marketplace source must reference the local generated plugin");
    }
  }
}

export async function checkProject(root: string): Promise<void> {
  const before = await hashTree(join(root, "plugins"));
  await buildArtifacts(root);
  const after = await hashTree(join(root, "plugins"));
  if (before !== after) throw new Error("Generated plugin artifacts were stale; rerun bun run build and commit the result");
  await validateProject(root);

  const forbidden: string[] = [];
  for (const path of await walkFiles(root)) {
    const rel = relative(root, path).replaceAll("\\", "/");
    if (rel.startsWith("dist/") || rel.startsWith("node_modules/") || rel.startsWith(".git/")) continue;
    if (HAND_AUTHORED_JAVASCRIPT.has(extname(path))) forbidden.push(rel);
  }
  if (forbidden.length) throw new Error(`Hand-authored JavaScript is not allowed: ${forbidden.join(", ")}`);
}

export function assertPlatform(value: string): asserts value is (typeof PLATFORMS)[number] {
  if (!PLATFORMS.includes(value as (typeof PLATFORMS)[number])) throw new Error(`Unsupported platform: ${value}`);
}
