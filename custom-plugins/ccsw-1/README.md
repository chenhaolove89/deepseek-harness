# ccswitch-import —— CCSwitch 导入 + 视觉描述

DeepSeek Harness 动态插件：从 [CCSWITCH](https://github.com/febobo/web-universal-mcp-switch)（`~/.cc-switch/cc-switch.db`）读取已保存的模型供应商，批量导入为 DSH 的模型供应商（写入 `llm-pi-ai` 设置与凭据），导入后立即可在模型选择器中使用。

## 功能

| 能力 | 说明 |
| --- | --- |
| `ccswitch_list`（AI 工具） | 列出 CCSWITCH 供应商：id、名称、类型、地址、模型数、是否可导入 |
| `ccswitch_import`（AI 工具） | 按 id 批量导入供应商（claude / codex / gemini 三种类型） |
| `visual_describe`（AI 工具） | 把图片交给视觉模型（默认 tokenrhythm/qwen3.8-max）描述，实现无多模态模型看图 |
| 设置页「CCSwitch 导入」 | GUI 多选导入界面（`settings.section` 插槽） |

## 移植到另一个 DSH 实例

把本仓库地址发给目标环境的 AI，AI 按以下步骤重建：

1. 读 `cordis.yml` + `host.js` / `client.js`，用 `cordis_inspect_list` / `cordis_inspect_query` 核对目标环境的 Service / Builtin / Slot 接口；
2. `cordis_define`（kind: new，idPrefix 建议 `ccsw`）传入 `code.host` / `code.client`；
3. `cordis_run` 激活；Client 半首次运行需在 GUI 授权一次；
4. 失败时用 `cordis_inspect_self` 读诊断后修包重试。

## 说明

- Host 半通过 `subprocess` 以只读方式打开 cc-switch 的 SQLite 数据库（`node:sqlite`），不改写任何 CCSWITCH 数据；
- 导入写入 DSH 的 `settings`（llm-pi-ai providers）与 `credentials`（CCSWITCH_*_KEY）；
- 视觉描述调用 `llm` 服务流式接口，输出上限 8192 tokens，兼容 reasoning 块。

## License

MIT © 2026 chenhaolove89
