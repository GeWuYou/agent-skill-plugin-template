import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { basename, join, relative } from "node:path";
import { buildArtifacts } from "./build.ts";
import { runGit } from "./release.ts";
import { sha256File, walkFiles } from "./fs.ts";

interface TarEntry {
  path: string;
  body: Buffer;
}

function writeString(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = Math.max(0, value).toString(8).padStart(length - 1, "0").slice(-(length - 1));
  writeString(buffer, offset, length, `${encoded}\0`);
}

function tarName(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  const split = path.lastIndexOf("/");
  if (split < 1) throw new Error(`Path is too long for ustar: ${path}`);
  const prefix = path.slice(0, split);
  const name = path.slice(split + 1);
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`Path is too long for ustar: ${path}`);
  return { name, prefix };
}

function tarHeader(entry: TarEntry, epoch: number): Buffer {
  const header = Buffer.alloc(512);
  const { name, prefix } = tarName(entry.path);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.body.length);
  writeOctal(header, 136, 12, epoch);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, "0");
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "root");
  writeString(header, 297, 32, "root");
  writeString(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function createTar(entries: TarEntry[], epoch: number): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    chunks.push(tarHeader(entry, epoch), entry.body);
    const padding = (512 - entry.body.length % 512) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

async function sourceEpoch(root: string): Promise<number> {
  const configured = process.env.SOURCE_DATE_EPOCH;
  if (configured && /^\d+$/.test(configured)) return Number(configured);
  try {
    return Number((await runGit(root, ["show", "-s", "--format=%ct", "HEAD"])).trim());
  } catch {
    return 0;
  }
}

async function sourceSha(root: string): Promise<string | null> {
  try {
    return (await runGit(root, ["rev-parse", "HEAD"])).trim();
  } catch {
    return null;
  }
}

async function bundleEntries(root: string): Promise<TarEntry[]> {
  const roots = ["plugins", "marketplaces", ".agents/plugins"];
  const standaloneFiles = ["README.md", "CHANGELOG.md", "LICENSE", "AGENTS.md", "CLAUDE.md", ".agent-plugin/config.json"];
  const paths: string[] = [];
  for (const directory of roots) paths.push(...await walkFiles(join(root, directory)));
  for (const file of standaloneFiles) if (existsSync(join(root, file))) paths.push(join(root, file));
  return Promise.all(paths.map(async (path) => ({ path: relative(root, path).replaceAll("\\", "/"), body: await readFile(path) })));
}

export interface PackageResult {
  bundle: string;
  checksums: string;
  provenance: string;
  version: string;
  tag: string;
}

export async function packageRelease(root: string, versionOverride?: string): Promise<PackageResult> {
  const { canonicalDigest, config } = await buildArtifacts(root, versionOverride);
  const releaseRoot = join(root, "release");
  await rm(releaseRoot, { recursive: true, force: true });
  await mkdir(releaseRoot, { recursive: true });
  const epoch = await sourceEpoch(root);
  const tar = createTar(await bundleEntries(root), epoch);
  const compressed = gzipSync(tar, { level: 9, mtime: 0 } as Parameters<typeof gzipSync>[1]);
  const bundle = join(releaseRoot, `${config.pluginId}-bundle-${config.version}.tar.gz`);
  await writeFile(bundle, compressed);

  const provenance = join(releaseRoot, `provenance-${config.version}.json`);
  await writeFile(provenance, `${JSON.stringify({
    schemaVersion: 1,
    pluginId: config.pluginId,
    packageName: config.packageName,
    version: config.version,
    tag: `v${config.version}`,
    sourceRepository: config.repositoryUrl,
    sourceSha: await sourceSha(root),
    sourceDateEpoch: epoch,
    canonicalDigest,
    bunVersion: Bun.version,
  }, null, 2)}\n`, "utf8");

  const checksums = join(releaseRoot, `checksums-${config.version}.sha256`);
  const checksumBody = [bundle, provenance]
    .map((path) => ({ path, name: basename(path) }));
  const checksumLines: string[] = [];
  for (const item of checksumBody) checksumLines.push(`${await sha256File(item.path)}  ${item.name}`);
  await writeFile(checksums, `${checksumLines.join("\n")}\n`, "utf8");
  return { bundle, checksums, provenance, version: config.version, tag: `v${config.version}` };
}

export async function sha256Buffer(buffer: Buffer): Promise<string> {
  return createHash("sha256").update(buffer).digest("hex");
}
