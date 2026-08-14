# 参考：模板与细节

## custom-plugins 目录结构

```
custom-plugins\
├── README.md
├── manifest.json              # 插件注册表（id / 路径 / 公开仓库）
├── sync.ps1                   # setup / status
├── skills\plugin-sourcelib\   # 技能种子（setup 安装到 ~/.dsh/skills）
├── presets\godot-dev\         # preset 种子（setup 安装到 ~/.dsh/.agent-presets）
├── presets\vue-admin\
├── template-demo\             # 新插件模板
├── ccsw-1\  ccsw-lite\  pdeep\   # 现有插件
```

## cordis.yml 清单模板

```yaml
# <id> 插件清单（manifest）—— 移植/恢复 AI 的规格
id: <id>
name: <显示名>
description: <一句话说明>
version: 0.1.0
platform: host            # host | client | both

files:
  host: host.js           # 仅 host/both
  client: client.js       # 仅 client/both

dependencies:
  host:
    services: [harness]   # 用到的 Host Service（用 cordis_inspect_list 核对）
    builtins: []
  client:
    services: [slots]
    slots:
      - tool.view.cordis  # 用到的 Slot（用 Slots.listSubTree 核对）
```

## host.js 模板

```js
// Host 半 —— 对应 cordis_define 的 code.host。纯 JavaScript。
return {
  apply(ctx) {
    const harness = ctx.get('harness')   // 可选依赖用 ctx.get + undefined 检查
    if (harness === undefined) return

    harness.registerTool(ctx, harness.defineTool({
      name: 'my_tool',
      description: '工具说明',
      parameters: {
        arg: { type: 'string', required: true, description: '参数说明' },
      },
      output: {
        schema: { type: 'string' },
        render(_args, value) { return [{ type: 'text', text: String(value) }] },
      },
      async execute(args) {
        return '结果'
      },
    }))
  },
}
```

## client.js 模板

```js
// Client 半 —— 对应 cordis_define 的 code.client。纯 JS + React.createElement。
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('<slot.name>', () => slots.register(
      { name: '<slot.name>', key: '<唯一键>' },
      (props) => React.createElement('div', null, '内容'),
    ))
  },
}
```

## 移植/恢复时的适配点

| 能力 | 核对方式 |
| --- | --- |
| Slot 键名/注册协议 | `Slots.listSubTree` |
| harness 签名 | `Builtin.listBuiltins` |
| Service 是否挂载 | `Service.listService` |
| 主题 token | `Theme.listTokens` |
| 工具是否重名 | `Tool.listTools` |

缺失的依赖要么换实现，要么明确告知用户。

## 源码校验（validate.ps1）

插件源码是"函数体"（cordis_define 的 code.host / code.client），顶层 `return` 合法；
`node --check` 会因所在目录的模块类型（CJS/ESM）行为不一致而误报，**不要用它校验**。

正确方式（new Function 按函数体解析）：

```powershell
custom-plugins\validate.ps1               # 校验全部插件
custom-plugins\validate.ps1 -Path ccsw-1  # 只校验一个插件
# 或单文件：
node -e "const fs=require('fs');new Function(fs.readFileSync(process.argv[1],'utf8'))" ccsw-1\host.js
```

## 多电脑同步机制

- 同步载体 = deepseek-harness-master **fork 仓库**（origin: chenhaolove89/deepseek-harness；upstream: deepseek-ai/deepseek-harness）
- 本机改完 → `git add custom-plugins && git commit` → `git push`；新电脑 → `git pull`
- 新机引导 = `custom-plugins\sync.ps1 setup`（安装技能 + presets 到 ~/.dsh）
- 公开分享 = 插件单独推送到自己的公开仓库（可选），加 `dsh-plugin` 话题
- 工作区 `plugins-local\`（若存在）是公开仓库的本地工作区，非同步主链路

**不要提交/同步**：`.credentials.yaml`、`.anonymous-user-id`、`~/.dsh\sessions`、`storages`、`attachments`、`profiles`、`.env`（含密钥）——密钥留在各机器本地。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 换新电脑后插件没了 | 动态插件按会话隔离、重启即丢；从 custom-plugins 重新 cordis_define + cordis_run 恢复 |
| 恢复后 Client 报错 | `cordis_inspect_self` 读 client-render 诊断；多为 Slot 键名/协议不匹配，修后定义新 Package 用 update 重试 |
| host.call 失败 | 检查 Host handler 名、pluginRunId、JSON 参数、handler 内真实 Service 依赖 |
| 运行前停在 awaiting-approval | 用户需在 UI 允许；被拒后不要自动重试 |
| setup 后技能没出现 | 确认 ~/.dsh/skills 下有 plugin-sourcelib；技能目录在**新会话**才会加载 |
| 想把插件变成常驻 preset | 需要打包 npm 包并在 .agent-presets 组合里引用（进阶改造，走 editing-cordis-compositions 流程） |
