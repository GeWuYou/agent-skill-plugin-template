# GeWuYou Agent Skill Plugin Template

A GitHub template for building portable Agent Skills plugins with Bun and TypeScript. One canonical source tree renders Claude, Codex, Universal, and marketplace artifacts deterministically.

## Requirements

- Bun `1.3.14`
- Git with tags available when previewing a release

Handwritten runtime code and tests are TypeScript. JavaScript under `dist/` is generated build output and must not be edited.

## Create a plugin

Install and verify the template repository:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
bun run validate
bun run check
```

Build the generator, initialize a project, and render its platform artifacts:

```sh
bun run build
bun run generator/dist/index.js init ../my-plugin
cd ../my-plugin
bun install --frozen-lockfile
bun run build
bun run typecheck
bun test
bun run validate
bun run check
```

The generator's command name is `create-agent-skill-plugin`. Generated projects keep editable content under `src/` and configuration under `.agent-plugin/config.json`; `plugins/`, `marketplaces/`, and `.agents/plugins/marketplace.json` are regenerated outputs.

Each Skill directory is copied as a unit, including `SKILL.md`, `agents/`, `scripts/`, `references/`, and `assets/`. Platform-specific names are applied consistently to Skill frontmatter, explicit Skill references, and `agents/openai.yaml`.

Generated projects expose Bun scripts for build, type checking, tests, validation, installation lifecycle, synchronization, packaging, release preview, and release preparation. Use `bun run package`, `bun run release:preview`, and `bun run release:prepare` for release-local checks; GitHub Actions remains the authority for an approved publication.

## Repository layout

- `template/` — canonical project template, sample Skill, and project lifecycle CLI.
- `generator/` — TypeScript `create-agent-skill-plugin` generator.
- `ci/` — TypeScript validation, version preview, packaging, and release preparation.
- `.github/workflows/` — GitHub quality and manually authorized release workflows.

Claude, Codex, and Universal outputs live under `plugins/`. Claude and Codex marketplace bundles live under `marketplaces/`; the root Codex marketplace points to the generated Codex plugin with a local relative source.

## Versioning and releases

Release versions are computed from Conventional Commits after the required `v0.0.0` baseline tag. Maintainers do not enter a version. A manual GitHub Actions dispatch previews the version and notes, then a protected `release` environment requires approval before the stable tag, archive, checksums, provenance, and GitHub Release are created.

The first `v1.0.0` release remains a separate manual dispatch and approval after this migration is merged. This repository does not publish a package-registry artifact. See [GitHub release process](docs/github-release.md).

## GitHub repository setup

After the migration PR passes `quality`, enable the repository as a GitHub template and protect `main`: require pull requests, the `quality` check, resolved conversations, and disallow force pushes and branch deletion. Configure the `release` environment with at least one required reviewer.
