# GitLab 发布

模板仓库的 CI 使用 Bun 验证 generator 和模板结构。受保护的 SemVer tag（`vMAJOR.MINOR.PATCH` 或 `-beta.N`）会注入 `RELEASE_VERSION`/`PLUGIN_VERSION` 并触发确定性 source archive 打包；Maintainer 手动运行发布作业后，归档、checksum 和 provenance 会上传到 GitLab Generic Package Registry 并创建 Release。

发布使用 `CI_API_V4_URL`、`CI_PROJECT_ID` 和 `CI_JOB_TOKEN`，不在仓库中保存 GitLab 地址或 token。模板归档包含 `template/`、`generator/` 及发布配置，不代表某个具体业务插件。
