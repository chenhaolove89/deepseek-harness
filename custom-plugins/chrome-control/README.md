# chrome-control —— Chrome 控制（CDP）

通过 Chrome DevTools Protocol 控制一台**专用 Chrome 实例**（独立临时用户目录 + `--remote-debugging-port`），提供 16 个模型工具：

| 工具 | 作用 |
| --- | --- |
| `chrome_open` / `chrome_close` | 启动/关闭专用 Chrome（可 headless） |
| `chrome_status` | 标签页列表与当前状态 |
| `chrome_goto` / `chrome_back` / `chrome_forward` / `chrome_reload` | 导航 |
| `chrome_new_tab` / `chrome_close_tab` | 标签页管理 |
| `chrome_dom` | 可见可交互元素 DOM 快照（nid + 坐标） |
| `chrome_click` / `chrome_type` / `chrome_keypress` / `chrome_scroll` | 交互（DOM 节点或视口坐标） |
| `chrome_screenshot` | 截图（视口/整页，PNG 落盘） |
| `chrome_eval` | 页面内只读 JS 求值 |

## 架构

```
Host 插件 --stdin/stdout JSON-RPC--> chrome-helper.mjs(Node>=22, 全局 WebSocket)
    --> --remote-debugging-port 启动专用 Chrome --> CDP(浏览器级 WS + Target.sendMessageToTarget)
```

- `host.js` —— 动态插件 Host 半源码（= cordis_define 的 code.host 原文），供会话内 `cordis_define` + `cordis_run` 恢复。
- `chrome-helper.mjs` —— Node 辅助进程（CDP 桥），**运行时资产**。
- `preset/plugin.js` —— 同一功能的**预设平面版**（真实 Cordis 插件，零外部依赖），用于挂进 agent preset（如 vue-admin），见 preset 种子 `custom-plugins/presets/vue-admin/`。

## 移植 / 恢复注意

1. **放置 helper**：把 `chrome-helper.mjs` 复制到目标工作区的 `.dsh-chrome/` 目录（host.js 从此路径读取并 spawn）。本仓库已在根目录附带运行时副本 `.dsh-chrome/chrome-helper.mjs`（与库内副本保持同源，clone 后即可用）。
2. **动态恢复**：读 `host.js` 内容 → `cordis_define`（kind: new + idPrefix，如 `chrom`）→ `cordis_run`。纯 Host 插件，无 Client 半，无需 UI 授权。
3. **预设挂载**：把 `preset/plugin.js` + `chrome-helper.mjs` 放进预设目录，并在 `agent.cordis.yml` 加行：
   ```yaml
   - id: chrome-control
     name: './chrome-control/plugin.js'
   ```
   相对行以预设目录为基准；`plugin.js` 刻意不 import 任何 `@deepseek-ai/*`（用户预设目录无 node_modules），工具定义手写 `ToolDefinition`。
4. **环境前提**：
   - Node >= 22（helper 用全局 `WebSocket`）；Chrome 可执行文件（Windows 注册表 App Paths / 常见安装路径 / `DSH_CHROME_PATH` 环境变量）。
   - Chrome 151+ 的 CDP 需用**浏览器级 WebSocket + `Target.attachToTarget(flatten:false)` + `sendMessageToTarget`**（直连 `/devtools/page/*` 与 flatten 会话可能无响应）。
   - 专用实例使用独立临时 profile，**不携带**用户日常浏览器的登录态。
   - 沙箱注意：从 pwsh 等受限工具启动的 Chrome 无法派生渲染进程，需从 Host 插件上下文 spawn（本插件正是如此）。
5. 验证：`custom-plugins\validate.ps1`（`host.js` 是函数体，顶层 return 合法，勿用 `node --check`；`preset/plugin.js`、`chrome-helper.mjs` 是真模块，用 `node --check`）。

## 已知限制

- 不做 iframe 内元素定位（DOM 快照仅顶层 document）。
- `chrome_click` 坐标点击依赖视口坐标；DOM 节点点击会自动滚动到可见后点中心。
- 一台机器同一时刻一个 helper 实例（预设 standing mount 共享）。
