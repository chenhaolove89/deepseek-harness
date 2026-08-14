// Client 半源码 —— 对应 cordis_define 的 code.client。
// 纯 JavaScript，用 React.createElement；无 JSX / TS / import。
// Slot 键名必须在目标环境用 Slots.listSubTree 核对后再定。
return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      (props) => React.createElement(
        'div',
        { style: { padding: '8px' } },
        `demo-hello 已运行（package: ${props.packageId}）`,
      ),
    ))
  },
}
