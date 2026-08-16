# dsh-git —— Codex 式 Git 管理插件（P0）

对标 Codex CLI 的 Git 集成（调研结论：Codex 本身没有独立 git 工具，全靠 bash 拼命令；本插件提供**结构化 git 工具 + 可视化面板**，是对 Codex 能力的超越与产品化）。

## 当前状态（P0，已完成）

- **Host**：注册三个只读结构化工具，模型可直接调用：

| 工具 | 功能 | 关键实现 |
| --- | --- | --- |
| `git_status` | 分支 / ahead-behind / 变更分组（已暂存、未暂存、未跟踪、冲突） | `--porcelain=v2 -b` 解析 |
| `git_diff` | 工作区 diff；`staged`/`stat`/`path` 参数 | `--cached` / `HEAD` / `--numstat`；200KB 截断提示 |
| `git_log` | 提交历史（hash\|作者\|日期\|主题） | `--pretty=format:` 管道分隔，n 上限 100 |

- 仓库根自动解析：`git -C <会话cwd> rev-parse --show-toplevel`（支持子目录会话）。
- 全部命令 `git -C <repo>` + argv 数组直调，无 shell 注入；`subprocess.spawn` + `signal` 支持取消。

## 路线图

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 只读三工具（status/diff/log） | ✅ 已完成 |
| P1 | 写操作：stage/unstage/commit/commit_message（LLM 生成，默认 tokenrhythm/qwen3.8-max，可配置）+ 危险操作显式 confirm | 待做 |
| P2 | Client 面板：侧边栏（`sidebar.footer.action`）+ 输入框快捷按钮（`conversation.input.left`）+ overlay 面板（`shell.overlay`） | 待做 |
| P3 | 分支/checkout/reset/revert/stash/push/pull/tag/clean/blame/show | 待做 |
| P4 | 设置页、`~/.dsh/dsh-git.json` 配置、可选静态化评估 | 待做 |

## 文件映射

| 文件 | 对应 cordis_define 的字段 |
| --- | --- |
| host.js | code.host（P0 为 host-only） |
| cordis.yml | 插件清单（真实 id：gitp-1） |

## 移植注意

- `subprocess` 服务签名需在目标环境用 `Service.listService` 核对（spawn spec 的 `signal` 字段、`collected` 读取）；
- `harness` 的签名需用 `Builtin.listBuiltins` 核对；
- 目标环境需安装 git（PATH 可解析 `git`）；
- P1 起需要 `llm` 服务（提交信息生成）；P2 起需要 Client 侧 `slots` 服务与 `sidebar.footer.action` / `conversation.input.left` / `shell.overlay` 三个 Slot（键名需用 `Slots.listSubTree` 核对）。

## 本地验证

```powershell
# 语法检查（new Function 按函数体解析；不要用 node --check；用 pwsh 7 运行，5.1 会中文乱码）
pwsh -File custom-plugins\validate.ps1 -Path custom-plugins\dsh-git
```

## 使用

插件运行后，对话中直接说"看下当前 git 状态 / diff / 历史"即可触发对应工具；`repoPath` 参数可指定其他仓库目录。
