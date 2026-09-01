import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const PLATFORMS = ["claude", "codex", "universal"] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface TemplateConfig {
  pluginId: string;
  displayName: string;
  description: string;
  authorName: string;
  authorEmail?: string;
  authorUrl?: string;
  license?: string;
  repositoryUrl: string;
  homepageUrl?: string;
  packageName?: string;
  packageSlug?: string;
  version?: string;
  defaultSkillPrefix?: string;
  supportedPlatforms?: Platform[];
  shortDescription?: string;
  longDescription?: string;
  developerName?: string;
  category?: string;
  capabilities?: string[];
  defaultPrompts?: string[];
  brandColor?: string;
}

export interface ResolvedConfig extends TemplateConfig {
  license: string;
  homepageUrl: string;
  packageName: string;
  packageSlug: string;
  version: string;
  defaultSkillPrefix: string;
  supportedPlatforms: Platform[];
  shortDescription: string;
  longDescription: string;
  developerName: string;
  category: string;
  capabilities: string[];
  defaultPrompts: string[];
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function resolveConfig(config: TemplateConfig, versionOverride?: string): ResolvedConfig {
  const packageSlug = nonEmpty(config.packageSlug) ?? config.pluginId.replace(/^agent-foundry-/, "");
  const version = nonEmpty(versionOverride) ?? nonEmpty(config.version) ?? "0.0.0";
  if (!STABLE_VERSION.test(version)) throw new Error(`Invalid stable version: ${version}`);
  const supportedPlatforms = config.supportedPlatforms ?? [...PLATFORMS];
  if (supportedPlatforms.some((platform) => !PLATFORMS.includes(platform))) {
    throw new Error("supportedPlatforms contains an unsupported platform");
  }

  const suggestedPrompt = `Use ${config.displayName} to help with this task.`;
  const defaultPrompts = config.defaultPrompts?.map((prompt) => prompt.trim()).filter(Boolean)
    ?? [suggestedPrompt.length <= 128 ? suggestedPrompt : "Use this plugin to help with this task."];
  return {
    ...config,
    authorEmail: nonEmpty(config.authorEmail),
    authorUrl: nonEmpty(config.authorUrl),
    license: nonEmpty(config.license) ?? "MIT",
    homepageUrl: nonEmpty(config.homepageUrl) ?? config.repositoryUrl,
    packageName: nonEmpty(config.packageName) ?? config.pluginId,
    packageSlug,
    version,
    defaultSkillPrefix: nonEmpty(config.defaultSkillPrefix) ?? `${packageSlug}-`,
    supportedPlatforms,
    shortDescription: nonEmpty(config.shortDescription) ?? config.description,
    longDescription: nonEmpty(config.longDescription) ?? config.description,
    developerName: nonEmpty(config.developerName) ?? config.authorName,
    category: nonEmpty(config.category) ?? "Development",
    capabilities: config.capabilities?.filter(Boolean) ?? ["Skills"],
    defaultPrompts: defaultPrompts.length ? defaultPrompts : [suggestedPrompt.length <= 128 ? suggestedPrompt : "Use this plugin to help with this task."],
    brandColor: nonEmpty(config.brandColor),
  };
}

export async function readConfig(root: string, versionOverride?: string): Promise<ResolvedConfig> {
  const path = join(root, ".agent-plugin", "config.json");
  const parsed = JSON.parse(await readFile(path, "utf8")) as TemplateConfig;
  return resolveConfig(parsed, versionOverride ?? process.env.PLUGIN_VERSION);
}
