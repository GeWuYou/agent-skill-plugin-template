import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readConfig, type Platform, type ResolvedConfig } from "./config.ts";
import { hashTree, walkFiles } from "./fs.ts";

const TEXT_SKILL_FILES = new Set(["SKILL.md", "openai.yaml"]);

async function copySkill(source: string, destination: string, canonicalName: string, outputName: string): Promise<void> {
  await cp(source, destination, { recursive: true });
  const templateSkill = join(destination, "SKILL.md.tmpl");
  const skillPath = join(destination, "SKILL.md");
  if (!existsSync(skillPath) && existsSync(templateSkill)) {
    await writeFile(skillPath, await readFile(templateSkill));
    await rm(templateSkill);
  }
  if (canonicalName === outputName) return;
  for (const path of await walkFiles(destination)) {
    if (!TEXT_SKILL_FILES.has(path.split(/[\\/]/).at(-1) ?? "")) continue;
    let body = await readFile(path, "utf8");
    if (path.endsWith("SKILL.md")) body = body.replace(/^name:\s*[^\n]+/m, `name: ${outputName}`);
    body = body.replaceAll(`$${canonicalName}`, `$${outputName}`).replaceAll(`@${canonicalName}`, `@${outputName}`);
    await writeFile(path, body, "utf8");
  }
}

async function copyCanonical(root: string, destination: string): Promise<void> {
  for (const dir of ["references", "contracts", "schemas", "tools", "templates"]) {
    const source = join(root, "src", dir);
    if (existsSync(source)) await cp(source, join(destination, dir), { recursive: true });
  }
}

function author(config: ResolvedConfig): Record<string, string> {
  const result: Record<string, string> = { name: config.authorName };
  if (config.authorEmail) result.email = config.authorEmail;
  if (config.authorUrl) result.url = config.authorUrl;
  return result;
}

function codexInterface(config: ResolvedConfig): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    displayName: config.displayName,
    shortDescription: config.shortDescription,
    longDescription: config.longDescription,
    developerName: config.developerName,
    category: config.category,
    capabilities: config.capabilities,
    defaultPrompt: config.defaultPrompts,
    brandColor: config.brandColor,
  }).filter(([, value]) => value !== undefined));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function renderMarketplace(root: string, platform: "claude" | "codex", config: ResolvedConfig): Promise<void> {
  const marketplaceRoot = join(root, "marketplaces", platform);
  await rm(marketplaceRoot, { recursive: true, force: true });
  const pluginSource = join(root, "plugins", platform, config.pluginId);
  const pluginTarget = join(marketplaceRoot, "plugins", config.pluginId);
  await cp(pluginSource, pluginTarget, { recursive: true });
  if (platform === "claude") {
    await writeJson(join(marketplaceRoot, ".claude-plugin", "marketplace.json"), {
      name: config.pluginId,
      owner: author(config),
      plugins: [{ name: config.pluginId, source: `./plugins/${config.pluginId}`, version: config.version }],
    });
    return;
  }
  await writeJson(join(marketplaceRoot, ".agents", "plugins", "marketplace.json"), {
    name: config.pluginId,
    interface: { displayName: config.displayName },
    plugins: [{
      name: config.pluginId,
      source: { source: "local", path: `./plugins/${config.pluginId}` },
      version: config.version,
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: config.category,
    }],
  });
}

export async function buildArtifacts(root: string, versionOverride?: string): Promise<{ canonicalDigest: string; config: ResolvedConfig }> {
  const config = await readConfig(root, versionOverride);
  const sourceRoot = join(root, "src");
  const sourceSkills = join(sourceRoot, "skills");
  const canonicalDigest = await hashTree(sourceRoot);
  await rm(join(root, "plugins"), { recursive: true, force: true });
  await rm(join(root, "marketplaces"), { recursive: true, force: true });

  const skills = (await readdir(sourceSkills, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const platform of config.supportedPlatforms) {
    const pluginRoot = platform === "universal"
      ? join(root, "plugins", "universal")
      : join(root, "plugins", platform, config.pluginId);
    const skillsRoot = platform === "universal" ? join(pluginRoot, ".agents", "skills") : join(pluginRoot, "skills");
    await mkdir(skillsRoot, { recursive: true });
    for (const skill of skills) {
      const outputName = platform === "claude" ? skill.name : `${config.defaultSkillPrefix}${skill.name}`;
      await copySkill(join(sourceSkills, skill.name), join(skillsRoot, outputName), skill.name, outputName);
    }

    if (platform !== "universal") {
      await copyCanonical(root, pluginRoot);
      for (const file of ["README.md", "LICENSE", "AGENTS.md"]) {
        if (existsSync(join(root, file))) await cp(join(root, file), join(pluginRoot, file));
      }
      const manifest = platform === "claude"
        ? {
            name: config.pluginId,
            displayName: config.displayName,
            description: config.description,
            version: config.version,
            author: author(config),
            repository: config.repositoryUrl,
            homepage: config.homepageUrl,
            license: config.license,
            skills: "./skills/",
          }
        : {
            name: config.pluginId,
            version: config.version,
            description: config.description,
            author: author(config),
            homepage: config.homepageUrl,
            repository: config.repositoryUrl,
            license: config.license,
            skills: "./skills/",
            interface: codexInterface(config),
          };
      const manifestDir = platform === "claude" ? ".claude-plugin" : ".codex-plugin";
      await writeJson(join(pluginRoot, manifestDir, "plugin.json"), manifest);
    }

    await writeJson(join(pluginRoot, ".agent-plugin", "provenance.json"), {
      pluginId: config.pluginId,
      packageVersion: config.version,
      platform,
      canonicalDigest,
      generatorVersion: "1.0.0",
    });
  }

  for (const platform of ["claude", "codex"] as const) {
    if (config.supportedPlatforms.includes(platform)) await renderMarketplace(root, platform, config);
  }
  if (config.supportedPlatforms.includes("codex")) {
    await writeJson(join(root, ".agents", "plugins", "marketplace.json"), {
      name: config.pluginId,
      interface: { displayName: config.displayName },
      plugins: [{
        name: config.pluginId,
        source: { source: "local", path: `./plugins/codex/${config.pluginId}` },
        version: config.version,
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: config.category,
      }],
    });
  }
  return { canonicalDigest, config };
}

export function pluginSkillsRoot(root: string, platform: Platform, pluginId: string): string {
  if (platform === "universal") return join(root, "plugins", "universal", ".agents", "skills");
  return join(root, "plugins", platform, pluginId, "skills");
}
