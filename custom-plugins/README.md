# custom-plugins —— 插件源码库（随 fork 仓库同步）

本目录保存全部插件的**权威源码副本**：一个插件 = 一个文件夹，被 `deepseek-harness-master` 仓库（你的 fork）git 跟踪。
换新电脑时克隆/拉取该仓库即可拿到全部插件源码，再用 AI 恢复运行。

## 目录约定

| 文件 | 内容 |
| --- | --- |
| host.js | 插件 Host 半源码（= cordis_define 的 code.host 原文） |
| client.js | 插件 Client 半源码（= code.client 原文） |
| cordis.yml | 插件清单 manifest：真实插件 id + 依赖能力（移植规格） |
| README.md | 功能说明 + 移植注意 |
| LICENSE | 许可证（可选） |

- 文件夹名是短句柄（如 ccsw-1），**真实插件 id 以 cordis.yml 为准**
- 新建插件：复制 `template-demo\` 起步
- 源码校验：`validate.ps1`（new Function 按函数体解析；**不要用 `node --check`**，它会受所在目录 CJS/ESM 影响误报）
- 工作流已固化为技能 **plugin-sourcelib**（种子在 `skills\plugin-sourcelib\`）

## 现有插件

| 文件夹 | 插件 | 状态 | 公开仓库（分享用） |
| --- | --- | --- | --- |
| ccsw-1 | CCSwitch 导入 + AI 工具 + 视觉描述（`ccswitch.list`/`ccswitch.import` RPC + `ccswitch_list`/`ccswitch_import`/`visual_describe` 工具） | **已静态化常驻** → `packages/client/ccswitch-import`（web-app 组合挂载） | dsh-ccswitch-import |
| ccsw-lite | CCSwitch 导入 Lite | 动态源码备份 | dsh-ccswitch-import-lite |
| pdeep | Prompt Deepen 提示词深化（`prompt-deepen` RPC） | **已静态化常驻** → `packages/client/prompt-deepen`（web-app 组合挂载） | dsh-prompt-deepen |
| chrome-control | Chrome 控制（CDP）：16 个 chrome_* 工具，驱动专用 Chrome 实例（含预设平面版 `preset/plugin.js`，可挂进 vue-admin 预设） | 动态源码备份 | dsh-chrome-control |
| dsh-git | Codex 式 Git 管理 v1.0：20 个 git 工具（只读/写/网络/危险确认/AI 提交信息）+ 15 RPC + Git 管理面板（侧边栏/输入框入口，overlay 浮层） | 动态源码备份（v1.0 已运行） | — |
| template-demo | 新插件模板（hello 示例） | — | — |

> **静态化说明**：ccsw-1 与 pdeep 已改造为仓库内 npm 包（`packages/client/`），由 `packages/bundle/web-app/cordis.patch.yml` 组合挂载。启动 GUI 即自动常驻（进程级、所有会话生效、重启不丢），**无需 cordis_define / cordis_run / UI 授权**。本目录的 `ccsw-1/`、`pdeep/` 保留为动态源码备份与移植规格。

## 新电脑部署（换新机）

1. `git clone https://github.com/chenhaolove89/deepseek-harness.git`（已有则 `git pull`）
2. 按仓库说明安装/运行 harness（含 `pnpm install` 与包构建）
3. 运行 `custom-plugins\sync.ps1 setup` —— 把 `skills\` 装到 `~/.dsh\skills`、`presets\` 装到 `~/.dsh\.agent-presets`，并**自动构建静态插件包**（`lib/` 不入库，新机 clone 后由 setup 用 tsc + tsdown 重建）
4. 启动 GUI —— **静态插件随组合自动常驻**，无需任何恢复步骤

## 日常同步

- 本机改完：`git add custom-plugins && git commit` → `git push`（fork）
- 新电脑：`git pull`

## 公开分享（可选）

想把插件分享给别人/被发现：把插件源码推到**自己的独立公开仓库**（如 dsh-ccswitch-import）并在仓库设置里添加 **`dsh-plugin` 话题**（官方建议）。
本目录副本 = 私有备份（随 fork 同步）；公开仓库 = 分享入口（两者各自维护）。

## 恢复方法（动态插件原理）

DSH 动态插件只存在于进程内存，进程重启后定义丢失。恢复方式：让 agent 读取本目录的
`host.js` / `client.js` 内容，调用 `cordis_define`（kind: new）与 `cordis_run` 重新创建运行即可。
client 半首次运行需要用户在 GUI 中批准。

## 插件自动更新（桌面客户端）

桌面客户端（`desktop-client`）启动时自动检查插件更新，覆盖全部插件通道：

| 通道 | 更新方式 | 新插件如何自动纳入 |
| --- | --- | --- |
| **web profile npm 插件** | 对比 npm registry，有新版执行 `dsh plugin --profile web add <包名>` | 把插件装进 `~/.dsh/profiles/web` 的 `package.json` `dependencies`（非 `@deepseek-ai/*` 包）即自动纳入，无需改代码 |
| **仓库静态插件**（`packages/client`） | 源码比 `lib/` 产物新时执行 `tsc -b` + `bundle` 重建 | 新增静态插件时把包名加进 `desktop-client\config.json` 的 `staticPlugins` 数组（默认含 `ccswitch-import`、`prompt-deepen`） |
| **custom-plugins 动态源码** | 随 fork 仓库 `git pull` 自动同步 | 本目录新增插件文件夹即自动随仓库同步（运行态恢复仍需 AI，见上节） |

> 检查时机：桌面客户端启动时（`checkPluginsOnStart: true`）与托盘「检查更新」手动触发；
> 发现更新弹窗，确认后应用。更新应用后的 host 半改动需在托盘「重启服务」生效。

## 技能与 preset 种子

- `skills\plugin-sourcelib\` —— 本工作流的技能种子（setup 时安装到 `~/.dsh\skills\`）
- `presets\godot-dev\`、`presets\vue-admin\` —— agent preset 种子（setup 时安装到 `~/.dsh\.agent-presets\`）
