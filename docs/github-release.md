# GitHub 自动版本与发布

版本号由提交历史自动计算，发布动作仍由维护者明确授权。发布工作流只允许从 `main` 手动触发，没有版本输入框，也不会发布到包注册表。

## 首次启用

在 GitHub Initial commit `7bb8089` 上创建并推送真实基线标签：

```sh
git tag v0.0.0 7bb8089
git push origin v0.0.0
```

生成的新项目也必须在初始化基线提交上创建并推送 `v0.0.0`。如果远端缺少该标签，Release Preview 必须失败，不能自行猜测首版。

GitHub 仓库还需要一个受保护的 `release` environment，并配置至少一名 required reviewer。`main` 应要求 pull request、`quality` 检查和已解决的讨论，同时禁止 force-push 与删除。

## 版本规则

版本计算以 `semantic-release` 为权威，并使用 Conventional Commits：

- `BREAKING CHANGE` footer 或 `type!:`：major
- `feat`：minor
- `fix`、`perf`、`refactor`、`deps`、`security`、`revert`：patch
- `docs`、`test`、`chore`、`build`、`ci`、`style`：不发布

迁移提交包含 breaking change，因此从 `v0.0.0` 预览出的首个稳定版应为 `v1.0.0`。迁移本身不会创建这个 Release；维护者必须在合入并验证流水线后单独手动触发和审批。

## Preview → Approval → Publish

1. 从 `main` 手动运行 GitHub Actions release workflow。工作流固定触发时的 commit SHA，并验证它等于远端 `main`。
2. Preview 以 dry-run 计算 `shouldRelease`、`lastTag`、`nextVersion`、`nextTag` 和 `releaseNotes`。没有可发布提交时成功结束，不创建标签或 Release。
3. 有候选版本时，publish job 进入受保护的 `release` environment 等待人工审批。
4. 审批后重新获取 `main` 和所有标签。如果 `main` 已移动，或重新计算的版本与 Preview 不一致，工作流失败并要求重新触发。
5. 版本一致时创建并推送标签，以该标签和 SHA 构建确定性制品，最后创建 GitHub Release。

工作流使用当前运行的 `GITHUB_TOKEN`；Preview 只需要 `contents: read`，publish job 单独授予 `contents: write`。发布采用 concurrency 串行化，且不会因后续运行而取消正在审批或发布的运行。

## 发布资产

模板仓库发布：

- `gewuyou-agent-skill-plugin-template-source-<version>.tar.gz`
- 对应 checksum 与 provenance
- 自动生成的 release notes

生成的插件项目发布：

- `<pluginId>-bundle-<version>.tar.gz`
- `checksums-<version>.sha256`
- `provenance-<version>.json`
- 自动生成的 release notes

制品必须只来源于已验证的 tag/SHA。相同源码重复打包应得到相同 checksum。

## 重跑与冲突

- 标签不存在：正常发布。
- 标签已存在并指向当前 SHA，且 Release、资产和 checksum 一致：验证后成功退出。
- 标签指向其他 SHA，或既有资产不一致：失败关闭，不移动标签、不覆盖 Release。

首次 `v1.0.0` 发布前，应确认 `quality` 已在受保护的 `main` 上成功、`v0.0.0` 指向 Initial commit，并且 Preview 给出预期的 `v1.0.0`。
