# Generated plugin guidance

Canonical Skill content belongs in `src/`. Do not edit generated `plugins/`, `marketplaces/`, `.agents/plugins/marketplace.json`, `dist/`, or `release/` artifacts by hand.

Use Bun 1.3.14 for every lifecycle command. Keep runtime code and tests in TypeScript; generated `dist/*.js` is the only JavaScript exception. Run the serial quality chain documented in `README.md` after changing canonical source, configuration, or lifecycle tooling.

Do not create or publish release tags manually beyond the required initialization baseline `v0.0.0`. Stable versions are calculated from Conventional Commits and published by the protected GitHub Release workflow.
