# godot-ctrl：AI 控制 Godot 编辑器/游戏

Host 动态插件。把 Godot AI（`godot_ai`）MCP 服务器的工具桥接为 DSH 的模型工具，
让 AI 直接控制 Godot 做**开发与测试**：场景/节点编辑、GDScript 编写、运行/停止游戏、
运行时输入模拟、GUT 测试执行、日志排查、截图。

## 原理

- 插件运行在 DSH Host 进程，通过 `subprocess` 服务 spawn `curl.exe` 对
  `http://127.0.0.1:8000/mcp` 发起 **MCP streamable-HTTP** JSON-RPC（自动
  `initialize` 握手、缓存 `Mcp-Session-Id`、连接丢失自动重连握手一次）。
- 不依赖 preset 里的 `mcp-godot` 行（`dsh-mcp-client`），因此**在任何 preset
  的会话里都能用**；同一台机器同时挂两者也不冲突。
- 截图流程：MCP 返回 base64 → `fs` 写 `.b64` → `certutil -decode` 落盘 PNG，
  返回路径供 `read_image` / `visual_describe` 查看。

## 使用前提

1. Godot 编辑器（4.5+）已启动，项目启用 `addons/godot_ai` 插件（Godot AI v3.x），
   MCP 服务器监听 `127.0.0.1:8000`。
2. `uv` 可用（插件自动安装/启动 Python 服务器）。

然后在新会话让 AI 执行：`godot_status` 检查连接 → 正常后即可
`godot_scene_tree` / `godot_node_*` / `godot_script_*` / `godot_project_run` /
`godot_game` / `godot_test_run` / `godot_screenshot` 等。

## 移植注意（新电脑）

- `cordis_define`（kind new，idPrefix `godot`）→ `cordis_run`；code.host 用
  `host.js` 原文。
- 关键契约（与 DSH 版本相关，移植时用 `cordis_inspect_list` / `cordis_inspect_query` 核对）：
  - `harness.defineTool(...)` 构造工具（marker 校验），`harness.registerTool(ctx, tool)` 注册；
    **不要**传裸 ToolDefinition。
  - `output.schema` 必须是 `{ type: 'object', additionalProperties: true }`（DSL 的
    value-schema 要求 object 显式声明 additionalProperties）。
  - `parameters` 用 JSON-Schema 包装形式 `{ type:'object', properties, required }`，
    根节点**不能**写 `additionalProperties:false`（隐式开放）；自由值字段省略 `type`
    （归一化为 `json`）。
  - `subprocess.spawn` 的 `SubprocessSpawnSpec`：`argv/cwd/stdio/graceMs` 全显式；
    stdin 批量用 `{ data }`，collect 输出经 `handle.collected.*.readFrom(0)` 读取。
- 目标服务器地址如需改动，改 `host.js` 里 `state.baseUrl`。
