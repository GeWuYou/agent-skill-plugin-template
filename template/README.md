# Example Agent Plugin

This generated repository is a Bun 1.3.14 and TypeScript starting point for one portable Agent Skills plugin. Canonical content lives in `src/`; `bun run build` renders installable Claude, Codex, and Universal artifacts into `plugins/` and `marketplaces/`.

## Prerequisites

- Bun 1.3.14
- Git
- A GitHub repository whose default branch is `main`

Install and verify the project:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
bun run validate
bun run check
```

`bun run build` compiles the lifecycle CLI to `dist/index.js` and renders every platform from the canonical source. `dist/` contains generated JavaScript; hand-authored runtime and test files remain TypeScript.

## Lifecycle commands

| Command | Purpose |
| --- | --- |
| `bun run build` | Compile the CLI and render all configured platforms. |
| `bun run validate` | Validate Skills, UI metadata, plugin manifests, and marketplaces. |
| `bun run check` | Prove generated artifacts are current and reject hand-authored JavaScript. |
| `bun run install --ai codex --target <path>` | Install managed skills for Claude, Codex, or Universal. |
| `bun run update --ai codex --target <path>` | Refresh an unmodified managed installation. |
| `bun run uninstall --target <path>` | Remove only unchanged managed files. |
| `bun run versions` / `bun run doctor` | Inspect versions and validate the local toolchain/configuration. |
| `bun run package` | Build a deterministic bundle, checksum file, and provenance document under `release/`. |
| `bun run release:preview` | Compute the next stable version from Conventional Commits. |
| `bun run release:prepare` | Recompute the approved candidate and let semantic-release publish its tag. |

`sync-project`, `sync-docs`, and `migrate` are reserved project hooks and are safe no-ops until customized.

## Automatic releases

Before the first release, create the required baseline tag on the initialization commit and push it:

```bash
git tag v0.0.0 <initialization-commit-sha>
git push origin v0.0.0
```

The release preview fails closed if `v0.0.0` is absent. Configure a GitHub environment named `release` with at least one required reviewer, then run the **Release** workflow from `main`. The workflow has no version input: semantic-release calculates the stable version from Conventional Commits, records the dispatch SHA, waits for approval, refetches and recalculates, and publishes only if `main`, the SHA, and the candidate version still agree.

Release rules are:

- `BREAKING CHANGE` or `type!` → major
- `feat` → minor
- `fix`, `perf`, `refactor`, `deps`, `security`, `revert` → patch
- `docs`, `test`, `chore`, `build`, `ci`, `style` → no release

Rerunning a completed release verifies that the existing tag and assets match. It never overwrites a conflicting tag or Release.
