# 自定义插件备份（CCSwitch 导入 + 视觉 + 提示词深化）

本目录保存从 DSH 会话历史中恢复的两个动态插件的最终版源码。

## ccsw-1（CCSwitch 导入 + AI 工具 + 视觉描述）

- `ccsw-1/host.js` — Host 半：cc-switch 数据库读取、`ccswitch.list` / `ccswitch.import` RPC、
  三个模型工具（`ccswitch_list`、`ccswitch_import`、`visual_describe`）
- `ccsw-1/client.js` — Client 半：设置页「CCSwitch 导入」界面（`settings.section` 插槽）

## pdeep（Prompt Deepen 提示词深化）

- `pdeep/host.js` — Host 半：`prompt-deepen` RPC（用当前选定模型深化提示词）
- `pdeep/client.js` — Client 半：输入框右侧深化按钮（`conversation.input.right` 插槽）

## 恢复方法

DSH 动态插件只存在于进程内存，进程重启后定义丢失。恢复方式：让 agent 读取
本目录的 `host.js` / `client.js` 内容，调用 `cordis_define`（kind: new）与
`cordis_run` 重新创建运行即可。client 半首次运行需要用户在 GUI 中批准。
