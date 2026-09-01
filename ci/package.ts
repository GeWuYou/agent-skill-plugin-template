import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { deterministicTarGzip, type TarEntry } from "./tar.ts";
import { runGit } from "./git.ts";

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ARCHIVE_PREFIX = "agent-skill-plugin-template";

function sha256(body: Buffer | string): string {
  return createHash("sha256").update(body).digest("hex");
}

async function trackedFiles(root: string): Promise<string[]> {
  return (await runGit(root, ["ls-files", "-z"]))
    .split("\0")
    .filter(Boolean)
    .filter((path) => !path.startsWith("dist/") && path !== ".gitlab-ci.yml")
    .sort();
}

export interface SourcePackageResult {
  bundle: string;
  checksums: string;
  provenance: string;
  version: string;
  tag: string;
  sourceSha: string;
}

export async function packageTemplate(root: string, version: string): Promise<SourcePackageResult> {
  if (!STABLE_VERSION.test(version)) throw new Error(`Invalid stable version: ${version}`);
  const sourceSha = (await runGit(root, ["rev-parse", "HEAD"])).trim();
  const trackedStatus = (await runGit(root, ["status", "--porcelain", "--untracked-files=no"])).trim();
  if (trackedStatus) throw new Error("Refusing to package a dirty tracked working tree");
  let tagSha: string;
  try {
    tagSha = (await runGit(root, ["rev-parse", "--verify", `refs/tags/v${version}^{}`])).trim();
  } catch {
    throw new Error(`Required release tag v${version} is missing`);
  }
  if (tagSha !== sourceSha) throw new Error(`Release tag v${version} does not point to HEAD`);
  const sourceEpoch = Number((await runGit(root, ["show", "-s", "--format=%ct", "HEAD"])).trim());
  const entries: TarEntry[] = [];
  for (const path of await trackedFiles(root)) {
    entries.push({ path: `${ARCHIVE_PREFIX}-${version}/${path.replaceAll("\\", "/")}`, body: await readFile(join(root, path)) });
  }
  const archive = deterministicTarGzip(entries, sourceEpoch);
  const outputRoot = join(root, "dist", "release");
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const bundle = join(outputRoot, `gewuyou-agent-skill-plugin-template-source-${version}.tar.gz`);
  await writeFile(bundle, archive);

  const provenance = join(outputRoot, `provenance-${version}.json`);
  const provenanceBody = `${JSON.stringify({
    schemaVersion: 1,
    package: "@gewuyou/agent-skill-plugin-template",
    version,
    tag: `v${version}`,
    source: "GeWuYou/agent-skill-plugin-template",
    sourceSha,
    sourceDateEpoch: sourceEpoch,
    archiveSha256: sha256(archive),
    bunVersion: Bun.version,
  }, null, 2)}\n`;
  await writeFile(provenance, provenanceBody, "utf8");

  const checksums = join(outputRoot, `checksums-${version}.sha256`);
  await writeFile(checksums, [
    `${sha256(archive)}  ${basename(bundle)}`,
    `${sha256(provenanceBody)}  ${basename(provenance)}`,
    "",
  ].join("\n"), "utf8");
  return { bundle, checksums, provenance, version, tag: `v${version}`, sourceSha };
}

if (import.meta.main) {
  const version = process.argv.find((_, index, args) => args[index - 1] === "--version")
    ?? process.env.RELEASE_VERSION
    ?? process.env.PLUGIN_VERSION;
  if (!version) throw new Error("Provide --version X.Y.Z or RELEASE_VERSION");
  console.log(JSON.stringify(await packageTemplate(process.cwd(), version), null, 2));
}
