# @deepseek-ai/dsh-prompt-deepen

提示词深化：在输入框工具行右侧提供「深化」按钮，用当前选定模型对草稿提示词
进行深化与优化，结果写回输入框。

## Model Experience

### Direct model-visible input

- 无模型工具。按钮通过 `promptDeepen` Remote 调用 Host，由 Host 使用当前
  选定模型发起一次独立 LLM 调用。

### Conditional model-visible input

- 仅当 Host 挂载 `llm` 与 `agentDefaultModel` 服务时可用（`inject` 声明）。

### Independent model request

- 每次点击发起一次独立的 LLM 调用（系统提示词为本包固定的提示词工程指令，
  `temperature: 0.7`，`maxTokens: 4096`），不写入会话日志。

### KV Cache effect

- 不改变模型请求前缀；每次调用独立发起。

## Known Limitations and Deferred Work

- 深化结果直接写回输入框草稿，不经过会话记录；用户发送前可自行编辑。
