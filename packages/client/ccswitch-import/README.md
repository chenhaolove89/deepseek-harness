# @deepseek-ai/dsh-ccswitch-import

CCSwitch 供应商导入 + 视觉描述。Host 面注册三个 AI 工具（`ccswitch_list`、
`ccswitch_import`、`visual_describe`）与 `ccswitch` Remote gateway；Client 面在
设置页注册「CCSwitch 导入」页面。

## Model Experience

### Direct model-visible input

- `ccswitch_list` / `ccswitch_import` / `visual_describe` 工具描述与参数
  schema 由本包注册，出现在模型工具目录中。

### Conditional model-visible input

- `ccswitch_list` / `ccswitch_import` 仅在 Host 挂载 `settings`、`credentials`、
  `subprocess` 服务时可用（`inject` 声明）；`visual_describe` 额外要求 `llm`、
  `fs`、`attachments`。

### Independent model request

- `visual_describe` 与 `ccswitch_import` 的每次执行都可能发起一次 LLM 调用
  （视觉描述）或写入凭据/设置，不改变模型请求缓存前缀。

### KV Cache effect

- 不改变模型请求。视觉调用每次独立发起，不参与会话缓存复用。

## Known Limitations and Deferred Work

- 仅在 Windows/macOS 的 cc-switch 数据库格式（SQLite `providers` 表）上验证；
  其他平台的 cc-switch 存储格式未覆盖。
- 导入仅支持 claude / codex / gemini 三种 cc-switch 供应商类型。
