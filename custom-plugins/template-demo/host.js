// Host 半源码 —— 对应 cordis_define 的 code.host。
// 纯 JavaScript；不 import / require / 用未声明的全局变量。
// 移植到目标环境前，先查 Builtin.listBuiltins 里的 harness 签名，按目标版本微调。
return {
  apply(ctx) {
    const harness = ctx.get('harness')
    if (harness === undefined) return

    harness.registerTool(ctx, harness.defineTool({
      name: 'hello_say',
      description: '向指定的人打招呼，返回一句问候语。',
      parameters: {
        name: { type: 'string', required: true, description: '要打招呼的人名' },
      },
      output: {
        schema: { type: 'string' },
        render(_args, value) { return [{ type: 'text', text: String(value) }] },
      },
      async execute(args) {
        return `Hello, ${args.name}! —— 来自 demo-hello 插件`
      },
    }))
  },
}
