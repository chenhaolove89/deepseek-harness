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

| 文件夹 | 插件 | 公开仓库（分享用） |
| --- | --- | --- |
| ccsw-1 | CCSwitch 导入 + AI 工具 + 视觉描述（`ccswitch.list`/`ccswitch.import` RPC + `ccswitch_list`/`ccswitch_import`/`visual_describe` 工具） | dsh-ccswitch-import |
| ccsw-lite | CCSwitch 导入 Lite | dsh-ccswitch-import-lite |
| pdeep | Prompt Deepen 提示词深化（`prompt-deepen` RPC） | dsh-prompt-deepen |
| template-demo | 新插件模板（hello 示例） | — |

## 新电脑部署（换新机）

1. `git clone https://github.com/chenhaolove89/deepseek-harness.git`（已有则 `git pull`）
2. 按仓库说明安装/运行 harness
3. 运行 `custom-plugins\sync.ps1 setup` —— 把 `skills\` 装到 `~/.dsh\skills`、`presets\` 装到 `~/.dsh\.agent-presets`
4. 新会话中 AI 自动加载 **plugin-sourcelib** 技能，按"流程 3"逐个用 `cordis_define` + `cordis_run` 恢复本目录插件（client 半首次运行需在 GUI 批准）

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

## 技能与 preset 种子

- `skills\plugin-sourcelib\` —— 本工作流的技能种子（setup 时安装到 `~/.dsh\skills\`）
- `presets\godot-dev\`、`presets\vue-admin\` —— agent preset 种子（setup 时安装到 `~/.dsh\.agent-presets\`）
