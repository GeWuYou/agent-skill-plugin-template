import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { runGit } from "./git.ts";

const root = process.cwd();
const forbiddenExtensions = new Set([".js", ".mjs", ".cjs", ".jsx"]);
const files = (await runGit(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]))
  .split("\0")
  .filter(Boolean);
const forbidden = files.filter((path) => existsSync(join(root, path)) && forbiddenExtensions.has(extname(path)) && !path.startsWith("generator/dist/") && !path.startsWith("template/dist/") && !path.startsWith("dist/"));
if (forbidden.length) throw new Error(`Hand-authored JavaScript is not allowed: ${forbidden.join(", ")}`);

for (const path of [
  "generator/src/index.ts",
  "template/cli/index.ts",
  "template/package.json",
  ".github/workflows/quality.yml",
  ".github/workflows/release.yml",
]) {
  if (!existsSync(join(root, path))) throw new Error(`Missing required project path: ${path}`);
}

const packageJson = await readFile(join(root, "package.json"), "utf8");
if (/\b(?:npm|npx|node)\b/.test(packageJson)) throw new Error("Root package scripts must use Bun entrypoints only");

for (const path of [".github/workflows/quality.yml", ".github/workflows/release.yml"]) {
  const workflow = parseYaml(await readFile(join(root, path), "utf8")) as unknown;
  if (!workflow || typeof workflow !== "object" || !("on" in workflow) || !("jobs" in workflow)) throw new Error(`Invalid GitHub workflow: ${path}`);
}
console.log("repository checks passed");
