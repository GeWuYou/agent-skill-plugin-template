/**
 * Small, dependency-free SemVer and Conventional Commit release calculator.
 *
 * The functions in this module are deliberately pure so a CI job can provide
 * git tags and commit subjects without allowing the calculator to mutate the
 * checkout.  Only stable releases and numeric beta prereleases are accepted.
 */

export type ReleaseChannel = 'stable' | 'beta';
export type ReleaseType = 'major' | 'minor' | 'patch' | 'none';

export type SemVer = {
  major: number;
  minor: number;
  patch: number;
  beta?: number;
};

export type VersionCalculation = {
  channel: ReleaseChannel;
  releaseType: Exclude<ReleaseType, 'none'> | 'none';
  version: string | null;
  tag: string | null;
  baseVersion: string;
  previousStableTag: string | null;
};

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/;
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/;
const RELEASE_ORDER: Record<ReleaseType, number> = { none: 0, patch: 1, minor: 2, major: 3 };

export function parseVersion(value: string): SemVer {
  const match = VERSION.exec(value.trim());
  if (!match) throw new Error(`Invalid SemVer (stable or beta only): ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), ...(match[4] === undefined ? {} : { beta: Number(match[4]) }) };
}

export function parseTag(value: string): SemVer {
  const match = TAG.exec(value.trim());
  if (!match) throw new Error(`Invalid release tag (expected vX.Y.Z or vX.Y.Z-beta.N): ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), ...(match[4] === undefined ? {} : { beta: Number(match[4]) }) };
}

export function formatVersion(version: SemVer): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.beta === undefined ? base : `${base}-beta.${version.beta}`;
}

export function formatTag(version: SemVer): string {
  return `v${formatVersion(version)}`;
}

/** Stable versions sort after their beta versions for the same base version. */
export function compareVersions(left: SemVer | string, right: SemVer | string): number {
  const a = typeof left === 'string' ? parseVersion(left.replace(/^v/, '')) : left;
  const b = typeof right === 'string' ? parseVersion(right.replace(/^v/, '')) : right;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.beta === undefined && b.beta !== undefined) return 1;
  if (a.beta !== undefined && b.beta === undefined) return -1;
  return (a.beta ?? 0) - (b.beta ?? 0);
}

function commitReleaseType(commit: string): ReleaseType {
  const header = commit.split(/\r?\n/, 1)[0];
  const breaking = /(?:^|\n)BREAKING CHANGES?:\s/i.test(commit) || /^[\w-]+(?:\([^)]*\))?!:/.test(header);
  if (breaking) return 'major';
  const type = /^(\w+)(?:\([^)]*\))?:/.exec(header)?.[1]?.toLowerCase();
  if (type === 'feat') return 'minor';
  if (['fix', 'perf', 'refactor', 'deps', 'security', 'revert'].includes(type ?? '')) return 'patch';
  return 'none';
}

export function releaseType(commits: readonly string[]): ReleaseType {
  return commits.reduce<ReleaseType>((current, commit) => {
    const next = commitReleaseType(commit);
    return RELEASE_ORDER[next] > RELEASE_ORDER[current] ? next : current;
  }, 'none');
}

export function calculateNextVersion(input: {
  baseVersion: string;
  commits?: readonly string[];
  channel?: ReleaseChannel;
  existingTags?: readonly string[];
  previousStableTag?: string | null;
}): VersionCalculation {
  const base = parseVersion(input.baseVersion);
  if (base.beta !== undefined) throw new Error('baseVersion must be stable');
  const channel = input.channel ?? 'stable';
  const type = releaseType(input.commits ?? []);
  const previousStableTag = input.previousStableTag ?? null;
  // Before the first stable tag there is no baseline commit range to bump.
  // Treat the configured base as the initial release, including beta previews.
  if (previousStableTag === null) {
    if (type === 'none') return { channel, releaseType: type, version: null, tag: null, baseVersion: formatVersion(base), previousStableTag };
    if (channel === 'stable') return { channel, releaseType: type, version: formatVersion(base), tag: formatTag(base), baseVersion: formatVersion(base), previousStableTag };
    const prefix = `${base.major}.${base.minor}.${base.patch}-beta.`;
    const max = (input.existingTags ?? []).reduce((highest, tag) => {
      try {
        const parsed = parseTag(tag);
        return parsed.major === base.major && parsed.minor === base.minor && parsed.patch === base.patch && parsed.beta !== undefined ? Math.max(highest, parsed.beta) : highest;
      } catch { return highest; }
    }, 0);
    return { channel, releaseType: type, version: `${prefix}${max + 1}`, tag: `${prefix.replace(/^/, 'v')}${max + 1}`, baseVersion: formatVersion(base), previousStableTag };
  }
  if (type === 'none') return { channel, releaseType: type, version: null, tag: null, baseVersion: formatVersion(base), previousStableTag };

  const next = { ...base };
  if (type === 'major') { next.major += 1; next.minor = 0; next.patch = 0; }
  else if (type === 'minor') { next.minor += 1; next.patch = 0; }
  else next.patch += 1;
  delete next.beta;
  if (channel === 'stable') return { channel, releaseType: type, version: formatVersion(next), tag: formatTag(next), baseVersion: formatVersion(base), previousStableTag };

  const prefix = `${next.major}.${next.minor}.${next.patch}-beta.`;
  const max = (input.existingTags ?? []).reduce((highest, tag) => {
    try {
      const parsed = parseTag(tag);
      return parsed.major === next.major && parsed.minor === next.minor && parsed.patch === next.patch && parsed.beta !== undefined ? Math.max(highest, parsed.beta) : highest;
    } catch { return highest; }
  }, 0);
  const beta = { ...next, beta: max + 1 };
  return { channel, releaseType: type, version: `${prefix}${beta.beta}`, tag: formatTag(beta), baseVersion: formatVersion(base), previousStableTag };
}
