# Maintainer notes

This is a GitHub-only, Bun `1.3.14`, TypeScript project. Keep canonical template content in `template/src`; do not hand-edit rendered plugin or marketplace output. JavaScript is allowed only as generated `dist/` output.

Before opening or merging a pull request, run:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
bun run validate
bun run check
```

Use Conventional Commits because release versions are calculated from commit history after `v0.0.0`. Do not set a release version manually. A stable release starts with the GitHub Actions manual release workflow and completes only after the protected `release` environment is approved.

The CLI command name is `create-agent-skill-plugin`. Do not promise package-registry publishing; release deliverables are GitHub Release assets.
