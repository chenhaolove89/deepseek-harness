# prompt-deepen —— Prompt Deepen 提示词深化

DeepSeek Harness 动态插件：在会话输入框工具行右侧添加「深化」按钮，用**当前选定的模型**对草稿提示词进行深化与优化（提示词工程），结果直接写回输入框，发送前可自行编辑。

## 功能

| 能力 | 说明 |
| --- | --- |
| 输入框深化按钮 | `conversation.input.right` 插槽，图标按钮；点击后调用当前模型 |
| 提示词工程系统指令 | 内置角色/目标/上下文/步骤/输出格式等 6 条优化要求，保留原始意图 |
| 状态反馈 | 成功（绿色勾选，提示已深化）/ 失败（红色，显示错误信息） |

## 移植到另一个 DSH 实例

把本仓库地址发给目标环境的 AI，AI 按以下步骤重建：

1. 读 `cordis.yml` + `host.js` / `client.js`，用 `cordis_inspect_list` / `cordis_inspect_query` 核对目标环境的 Service / Slot 接口；
2. `cordis_define`（kind: new，idPrefix 建议 `pdeep`）传入 `code.host` / `code.client`；
3. `cordis_run` 激活；Client 半首次运行需在 GUI 授权一次；
4. 失败时用 `cordis_inspect_self` 读诊断后修包重试。

## 说明

- 依赖 Host 的 `llm` 与 `agentDefaultModel` 服务：深化使用当前会话选定的模型路由；
- 调用参数：`temperature: 0.7`、`maxTokens: 4096`，独立 LLM 调用，不写入会话日志；
- Client 半需要 `timer` 服务（成功提示 3 秒后自动消失）。

## License

MIT © 2026 chenhaolove89
