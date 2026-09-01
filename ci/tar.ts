import { gzipSync } from "node:zlib";

export interface TarEntry {
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

function splitName(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  const split = path.lastIndexOf("/");
  if (split < 1) throw new Error(`Path is too long for ustar: ${path}`);
  const prefix = path.slice(0, split);
  const name = path.slice(split + 1);
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`Path is too long for ustar: ${path}`);
  return { name, prefix };
}

function header(entry: TarEntry, epoch: number): Buffer {
  const buffer = Buffer.alloc(512);
  const { name, prefix } = splitName(entry.path);
  writeString(buffer, 0, 100, name);
  writeOctal(buffer, 100, 8, 0o644);
  writeOctal(buffer, 108, 8, 0);
  writeOctal(buffer, 116, 8, 0);
  writeOctal(buffer, 124, 12, entry.body.length);
  writeOctal(buffer, 136, 12, epoch);
  buffer.fill(0x20, 148, 156);
  writeString(buffer, 156, 1, "0");
  writeString(buffer, 257, 6, "ustar\0");
  writeString(buffer, 263, 2, "00");
  writeString(buffer, 265, 32, "root");
  writeString(buffer, 297, 32, "root");
  writeString(buffer, 345, 155, prefix);
  const checksum = buffer.reduce((sum, value) => sum + value, 0);
  writeString(buffer, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return buffer;
}

export function deterministicTarGzip(entries: TarEntry[], epoch: number): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    chunks.push(header(entry, epoch), entry.body);
    const padding = (512 - entry.body.length % 512) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 } as Parameters<typeof gzipSync>[1]);
}
