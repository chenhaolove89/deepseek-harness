---
name: plugin-sourcelib
description: 管理插件源码库 custom-plugins（deepseek-harness-master fork 仓库内）：一个插件一个文件夹，源码随仓库同步到任何电脑。新电脑流程 = 克隆 fork → 运行 custom-plugins\sync.ps1 setup（安装技能与 preset 到 ~/.dsh）→ AI 用 cordis_define/cordis_run 恢复插件。当用户提到 custom-plugins、插件导出/入库/恢复/备份/同步/多电脑/移植，或需要把动态插件保存成可版本控制的源码时使用。
---

# 插件源码库（custom-plugins）

## 核心约定

- 库根：`deepseek-harness-master\custom-plugins\`——在你**自己的 fork 仓库**内，被 git 跟踪，随仓库同步到任何电脑
- 一个插件 = 一个子文件夹 = 一份完整源码（不含 .git）
- 文件约定：

| 文件 | 内容 |
| --- | --- |
| host.js | 插件 Host 半源码（= cordis_define 的 code.host 原文） |
| client.js | 插件 Client 半源码（= code.client 原文） |
| cordis.yml | 插件清单 manifest：真实插件 id + 依赖能力（移植规格） |
| README.md | 功能说明 + 移植注意 |
| LICENSE | 许可证（可选） |

- 文件夹名是短句柄（如 ccsw-1），**真实插件 id 以 cordis.yml 为准**
- 新建插件复制 `template-demo\`；技能种子在 `custom-plugins\skills\plugin-sourcelib\`，preset 种子在 `custom-plugins\presets\`
- host.js / client.js 必须保持纯 JavaScript（无 import/require/JSX/TS）

## 流程 1：新建插件

1. 复制 `custom-plugins\template-demo\` → 新文件夹
2. 改 cordis.yml 的 id/name/description/platform + 依赖能力；重写 host.js / client.js / README.md
3. 校验：`custom-plugins\validate.ps1`（new Function 按函数体解析，**勿用 node --check**）
4. `git add custom-plugins/<新文件夹>` → commit → push（插件随 fork 仓库同步）

## 流程 2：把会话中的动态插件入库

1. 在**创建插件的那个会话**里 `cordis_inspect_self(pluginId, packageId)` 读取源码
2. code.host → host.js，code.client → client.js（原样保存）
3. 补 cordis.yml（真实 id + 依赖能力）与 README.md
4. `validate.ps1` 校验 → commit → push

## 流程 3：新电脑部署

1. `git clone https://github.com/chenhaolove89/deepseek-harness.git`（已有则 `git pull`）
2. 按仓库说明安装/运行 harness
3. 运行 `custom-plugins\sync.ps1 setup`：skills\ → `~/.dsh\skills`，presets\ → `~/.dsh\.agent-presets`
4. 新会话 AI 自动加载本技能 → 逐个把 custom-plugins 里的插件 `cordis_define` + `cordis_run` 恢复（client 半需一次 UI 授权；失败用 `cordis_inspect_self` 读诊断修包重试）
5. 日常更新 = `git pull`，插件源码变更随仓库到达

## 流程 4：把插件移植给别人（对话方式）

把插件文件夹源码（或公开仓库地址）给对方的 AI：

1. 读 cordis.yml + host.js/client.js，列出依赖的 Service/Event/Slot/Builtin/Token
2. 用 `cordis_inspect_list` / `cordis_inspect_query` 核对**对方环境**的真实接口，版本不同就适配源码
3. `cordis_define` + `cordis_run` 重建；Client 半需一次授权
4. 公开发布：推到自己的独立仓库并添加 `dsh-plugin` 话题（官方建议，便于被发现）

## 验证清单

- [ ] 所有插件源码通过 `custom-plugins\validate.ps1`（new Function 校验）
- [ ] cordis.yml 的 id 合法（小写/数字/连字符），platform 正确
- [ ] 变更已 commit 并 push 到 fork（多机同步的前提）
- [ ] 新电脑 `sync.ps1 setup` 后技能与 preset 出现在 ~/.dsh 对应目录
- [ ] 恢复/移植后 Run 卡无报错，工具/UI 可调用

## 详细参考

- 模板全文、manifest 格式、同步机制、常见问题 → [reference.md](reference.md)
