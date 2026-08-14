# template-demo —— 新插件模板

新建插件的最小起点：复制本文件夹后改 cordis.yml（id/name/description/platform）并重写 host.js / client.js / README.md。

- **Host**：注册 `hello_say` 工具（向指定的人打招呼）
- **Client**：在最新一次 `cordis_run` 的运行卡上显示一条问候（Slot: `tool.view.cordis`）

## 文件映射

| 文件 | 对应 cordis_define 的字段 |
| --- | --- |
| host.js | code.host |
| client.js | code.client |
| cordis.yml | 插件清单（移植规格） |

## 移植注意

- Slot 键名（`tool.view.cordis`）与主题 token 需在目标环境用 `Slots.listSubTree` / `Theme.listTokens` 核对；
- `harness` 的签名需在目标环境用 `Builtin.listBuiltins` 核对；
- Client 半首次运行需要一次 UI 授权。

## 在本地验证

```powershell
# 语法检查（new Function 按函数体解析；不要用 node --check）
custom-plugins\validate.ps1 -Path .
```
