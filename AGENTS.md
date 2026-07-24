# 项目 Agent 规则

## 发布与版本

- npm 包名是 `@zkl2333/freetype-wasm`。
- npm 包版本、Git tag 与 FreeType 上游正式版本严格 `1:1`：FreeType `X.Y.Z` 对应 npm `X.Y.Z` 和 tag `vX.Y.Z`。
- wrapper、构建脚本或 CI 的改进不能自行递增 npm 版本；已发布版本之后的改进留在 `main`，等待下一个 FreeType 正式版本。
- npm 版本和发布 tag 均不可变。不得覆盖、移动或复用已经发布过的版本或 tag。
- 只允许通过 `.github/workflows/publish-npm.yml` 和 npm Trusted Publisher 发布。不得在本地执行 `npm publish`，不得添加或使用 `NPM_TOKEN`。

## 永久禁止的版本

`@zkl2333/freetype-wasm@3.0.0` 曾被误发布后撤回。npm 的不可变规则意味着这个包名下的 `3.0.0` 已被永久占用，即使 registry 查询返回 404，也永远不能再次发布。

- **禁止发布 npm `3.0.0`。**
- **禁止创建或恢复 Git tag `v3.0.0`。**
- 不得尝试用 `3.0.0+build` 绕过；npm 会将 build metadata 清洗为 `3.0.0`，仍然冲突。
- 如果 FreeType 上游将来发布 `3.0.0`，立即停止发布流程并向用户说明此限制。不得自行选择 prerelease、合成版本、独立 wrapper 版本或新包名；具体方案由用户届时决定。

## 发布操作前的强制检查

任何 agent 在修改发布策略、触发发布、创建/删除 tag 或执行 npm 撤回前，必须：

1. 先读取本文件和 `RELEASING.md`。
2. 只读检查 npm 已发布版本、dist-tags、远端 tag 及其 commit。
3. 明确告诉用户将改变的精确版本/tag，以及 npm 撤回后版本永久不可复用的后果。
4. 获得用户对该精确操作的明确确认后才能继续；笼统的“发布”“回退”不能视为对不可逆操作的确认。

当前有效发布基线是 npm `2.14.3` / Git tag `v2.14.3`。不得撤回 npm `2.14.3`，也不得删除或移动 `v2.14.3`。
