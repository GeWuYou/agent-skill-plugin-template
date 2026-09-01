# Agent Skill Plugin Template

A small, reusable starting point for Agent Skills plugin projects. It keeps one canonical `src/` tree and deterministically renders Claude, Codex, Universal, and marketplace artifacts.

## Create a plugin

```sh
bun install
bun run build
bun generator/dist/index.js init ../my-plugin
cd ../my-plugin
node ../agent-skill-plugin-template/generator/dist/index.js render --project .
```

The generator uses Bun for package management and Node.js 20+ compatible TypeScript source. Generated output is disposable; edit only `src/` and `.agent-plugin/config.json`. No PowerShell wrappers or legacy compatibility aliases are included. Use `bun run typecheck`, `bun test`, and `bun run validate` before release.

## Layout

- `template/` — canonical starter tree and examples.
- `generator/` — TypeScript CLI (`init`, `render`, `validate-template`).
- `examples/` — minimal fixture used by tests and documentation.

Generated artifacts are written under `plugins/` and `marketplaces/`. The generator also writes the root Codex marketplace manifest at `.agents/plugins/marketplace.json`; it points to `./plugins/codex/<pluginId>` so the repository can be added directly as a remote Codex marketplace. When adding the repository in Codex, pin the Git ref to a release tag and leave the sparse path empty. `.agent-plugin/provenance.json` records the canonical digest and generator version.
