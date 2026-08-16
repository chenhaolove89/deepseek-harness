# dsh-git —— Codex 式 Git 管理插件

对标 Codex CLI 的 Git 集成（调研结论：Codex 本身没有独立 git 工具，全靠 bash 拼命令；本插件提供**结构化 git 工具 + 可视化面板**，是对 Codex 能力的超越与产品化）。

## 功能总览（v1.0 完整版）

### Host：20 个结构化 git 工具

| 类别 | 工具 | 说明 |
| --- | --- | --- |
| 只读 | `git_status` / `git_diff` / `git_log` / `git_show` / `git_blame` | porcelain v2 分组解析、numstat、容量截断 |
| 写 | `git_stage` / `git_unstage` / `git_commit` / `git_commit_message` | 暂存/取消暂存/提交/AI 生成提交信息 |
| 分支 | `git_branch` / `git_checkout` / `git_reset` / `git_revert` | list/create/switch/delete；soft/mixed/hard |
| 暂存区 | `git_stash` | list/push/pop/apply/drop/clear |
| 网络 | `git_fetch` / `git_pull` / `git_push` | 需要网络访问 |
| 标签/清理 | `git_tag` / `git_clean` | list/create/delete；dry-run 预览 |
| 兜底 | `git_run` | 任意 git 子命令（需确认+审批） |

**安全模型**（对齐 Codex 的分级思路）：
- 只读工具直接执行；
- 常规写工具直接执行但结果详述；
- 危险写工具（`push --force`、`reset --hard`、`checkout --force`、`branch -D`、`stash drop/clear`、`tag -d`、`clean`、`git_run`）必须显式 `confirm: true`，且经会话审批服务（`ask` 策略弹窗、`never` 策略拒绝）。
- 全部命令 `git -C <repo>` + argv 数组直调，无 shell 注入；输出容量截断保护。

### Host：15 个面板 RPC（`git.*`）

`panelState` / `stage` / `unstage` / `commit` / `commitMessage` / `show` / `diff` / `log` / `branch` / `checkout` / `pull` / `push` / `reset` / `clean` / `stash`（RPC 无会话上下文，`repoPath` 必传；危险项由 UI 二次确认后传 `confirm: true`）。

### Client：Git 管理面板

- 入口：侧边栏底部（`sidebar.footer.action`，id `git-panel`）+ 输入框工具行（`conversation.input.left`，id `git-panel-input`）；
- 浮层：`shell.overlay`（id `git-panel-overlay`），五个标签页：
  - **变更**：冲突/已暂存/未暂存/未跟踪分组，逐文件暂存/取消暂存/查看 diff；
  - **提交**：提交信息编辑 +「AI 生成提交信息」（Conventional Commits，默认 `tokenrhythm/qwen3.8-max`，可配置）+ 提交；
  - **历史**：最近提交列表，点击查看提交 diff；
  - **分支**：新建/切换/删除（删除二次确认）；
  - **更多**：pull/push/强制推送、reset soft/mixed/hard、clean 预览/执行、stash push/pop/list；
- 危险操作统一走二次确认弹窗（人类点击 = 确认信号）；
- 仓库目录默认取当前会话工作目录（`useSessions` → `byId[current].cwd`），可手动修改。

## 配置（可选）

`~/.dsh/dsh-git.json`（不存在时全部走默认值）：

```json
{
  "commitModel": { "provider": "tokenrhythm", "model": "qwen3.8-max" },
  "autoRefreshMs": 5000
}
```

- `commitModel`：AI 生成提交信息的模型路由（需已导入该供应商，否则工具会报错并提示配置）；
- `autoRefreshMs`：保留字段（面板当前为手动刷新，未使用轮询）。

## 文件映射

| 文件 | 对应 cordis_define 的字段 |
| --- | --- |
| host.js | code.host |
| client.js | code.client |
| cordis.yml | 插件清单（真实 id：gitp-2） |

## 移植注意

- Host：`subprocess` / `llm` / `approval` 服务签名需在目标环境用 `Service.listService` 核对；`harness` 签名用 `Builtin.listBuiltins` 核对；目标环境需安装 git（PATH 可解析）。
- Client：`sidebar.footer.action` / `conversation.input.left` / `shell.overlay` 三个 Slot 的键名与 props 需用 `Slots.listSubTree` 核对（本插件用到了 `sidebar.footer.action` 的 `wide` prop 与 `shell.overlay` 的 `useSessions` 标准 prop）；`host.call` 需 `host` builtin。
- Client 半首次运行需要一次 GUI 授权（run 卡勾选）。

## 本地验证

```powershell
# 语法检查（new Function 按函数体解析；不要用 node --check；用 pwsh 7 运行，5.1 会中文乱码）
pwsh -File custom-plugins\validate.ps1 -Path custom-plugins\dsh-git
```

## 已知限制（Known Limitations）

- 危险工具在会话审批策略为 `never` 时会被审批服务拒绝（设计如此：无审批即拒绝，不绕过）；
- 面板无自动刷新（手动刷新 + 操作后自动刷新）；`autoRefreshMs` 为保留字段；
- 删除分支（`-d`/`-D`）、`git_revert` 等操作不产生 undo 快照，需自行用 `git log`/reflog 核对；
- RPC 无会话上下文，面板必须传 `repoPath`（默认取当前会话 cwd，改仓库需手动改输入框）。
