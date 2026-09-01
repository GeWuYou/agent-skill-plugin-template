import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { buildArtifacts, pluginSkillsRoot } from "./build.ts";
import type { Platform } from "./config.ts";
import { sha256File, walkFiles } from "./fs.ts";

interface ManagedFile {
  path: string;
  sha256: string;
}

interface ManagedState {
  version: 1;
  platform: Platform;
  files: ManagedFile[];
}

function destinationSkillsRoot(target: string, platform: Platform): string {
  if (platform === "claude") return join(target, ".claude", "skills");
  if (platform === "codex") return join(target, ".codex", "skills");
  return join(target, ".agents", "skills");
}

function assertInside(target: string, path: string): void {
  const rel = relative(resolve(target), resolve(path));
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`Managed path escapes installation target: ${path}`);
  }
}

export async function installProject(root: string, target: string, platform: Platform, mode: "install" | "update"): Promise<void> {
  const { config } = await buildArtifacts(root);
  const sourceRoot = pluginSkillsRoot(root, platform, config.pluginId);
  if (!existsSync(sourceRoot)) throw new Error(`Platform was not built: ${platform}`);
  const destinationRoot = destinationSkillsRoot(target, platform);
  const records: ManagedFile[] = [];
  const conflicts: string[] = [];
  for (const source of await walkFiles(sourceRoot)) {
    const destination = join(destinationRoot, relative(sourceRoot, source));
    assertInside(target, destination);
    const digest = await sha256File(source);
    if (existsSync(destination) && await sha256File(destination) !== digest) conflicts.push(relative(target, destination));
    records.push({ path: relative(target, destination).replaceAll("\\", "/"), sha256: digest });
  }
  if (conflicts.length) throw new Error(`Managed file conflict: ${conflicts.join(", ")}`);
  for (const record of records) {
    const source = join(sourceRoot, relative(destinationRoot, join(target, record.path)));
    const destination = join(target, record.path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
  const state: ManagedState = { version: 1, platform, files: records };
  const statePath = join(target, ".agent-plugin", "managed-files.json");
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(`${mode} complete (${records.length} managed files)`);
}

export async function uninstallProject(target: string): Promise<void> {
  const statePath = join(target, ".agent-plugin", "managed-files.json");
  if (!existsSync(statePath)) {
    console.log("No managed installation found");
    return;
  }
  const state = JSON.parse(await readFile(statePath, "utf8")) as ManagedState;
  const modified: string[] = [];
  for (const record of state.files ?? []) {
    const path = join(target, record.path);
    assertInside(target, path);
    if (existsSync(path) && await sha256File(path) !== record.sha256) modified.push(record.path);
  }
  if (modified.length) throw new Error(`Refusing to remove modified files: ${modified.join(", ")}`);
  for (const record of state.files ?? []) await rm(join(target, record.path), { force: true });
  await rm(statePath, { force: true });
  console.log("uninstall complete");
}
