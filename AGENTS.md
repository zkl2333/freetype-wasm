# 项目 Agent 规则

## 发布与版本

- npm 包名是 `@zkl2333/freetype-wasm`。
- npm 包版本、Git tag 与 FreeType 上游正式版本严格 `1:1`：FreeType `X.Y.Z` 对应 npm `X.Y.Z` 和 tag `vX.Y.Z`。
- wrapper、构建脚本或 CI 的改进不能自行递增 npm 版本；已发布版本之后的改进留在 `main`，等待下一个 FreeType 正式版本。
- npm 版本和发布 tag 均不可变。不得覆盖、移动或复用已经发布过的版本或 tag。
- 只允许通过 `.github/workflows/publish-npm.yml` 和 npm Trusted Publisher 发布。不得在本地执行 `npm publish`，不得添加或使用 `NPM_TOKEN`。

Agent 不得因为代码已经完善、需要发布修复、SemVer 看起来合理或用户笼统地说“发布”，就自行选择新版本、改变版本策略或触发发布。必须先核对 FreeType 官方正式版本及现有 npm/tag 状态，再把拟发布的精确版本和理由告诉用户，取得明确确认。

## 不可逆操作

- npm 的 `package@version` 一经发布就永久占用，不能覆盖；撤回后同名同版本也不能重新发布。
- **不要把 `npm unpublish` 作为误发布的默认处理建议。** 先停止操作并保留现场，评估保持现状、修正 dist-tag、deprecate 或等待后续版本等方案。
- 在提到撤回方案时，必须先明确告诉用户：撤回不可撤销、会永久损失该版本号，并可能破坏已经安装或锁定该版本的用户。
- 除非用户在知晓上述后果后，明确指定要撤回的完整包名和版本，否则不得建议或执行 `npm unpublish`。
- 创建/删除 Git tag、修改 npm dist-tag、触发发布 workflow 和撤回 npm 版本是相互独立的操作；对其中一项的授权不能扩展为其他操作。
- 不得把笼统的“发布”“回退”“你来做”解释为执行不可逆 registry 或 tag 操作的授权。

## 发布操作前的强制检查

任何 agent 在修改发布策略、触发发布、创建/删除 tag 或执行 npm 撤回前，必须：

1. 先读取本文件和 `RELEASING.md`。
2. 核对 FreeType 官方正式版本，不得把 wrapper 自身版本误当成上游版本。
3. 只读检查 npm 已发布版本、dist-tags、远端 tag 及其 commit。
4. 明确列出准备执行的每个写操作、精确版本/tag 和可逆性，不得省略 npm 的不可变规则。
5. 获得用户对每个不可逆操作的明确确认后才能继续。
