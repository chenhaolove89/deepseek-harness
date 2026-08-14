return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const timer = ctx.get('timer')

    styles.insert(`
      .dsh-pdeepen {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; padding: 0; flex: none;
        border: none; border-radius: 6px; background: transparent;
        color: var(--dsw-alias-label-secondary); cursor: pointer;
      }
      .dsh-pdeepen:hover {
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary);
      }
      .dsh-pdeepen:disabled { cursor: default; opacity: .6; }
      .dsh-pdeepen-spin svg { animation: dsh-pdeepen-rot .9s linear infinite; }
      @keyframes dsh-pdeepen-rot { to { transform: rotate(360deg); } }
    `)

    slots.inject('conversation.input.right', () => slots.register(
      { name: 'conversation.input.right', id: 'prompt-deepen', order: 0 },
      (props) => {
        const [busy, setBusy] = React.useState(false)
        const [state, setState] = React.useState(null)
        const draft = (props && props.input && props.input.draft) || ''
        const actions = props && props.inputActions

        const onClick = async () => {
          const text = String(draft).trim()
          if (!text) {
            setState({ kind: 'error', text: '请先输入提示词' })
            return
          }
          if (busy) return
          setBusy(true)
          setState(null)
          try {
            const res = await host.call('prompt-deepen', { text })
            if (res && res.ok && typeof res.text === 'string' && res.text) {
              if (actions && typeof actions.setDraft === 'function') actions.setDraft(res.text)
              setState({ kind: 'ok', text: '提示词已深化，请检查后发送' })
              if (timer && typeof timer.timeout === 'function') {
                timer.timeout(() => setState((s) => (s && s.kind === 'ok' ? null : s)), 3000)
              }
            } else {
              setState({ kind: 'error', text: (res && res.error) ? String(res.error) : '深化失败，请重试' })
            }
          } catch (err) {
            setState({ kind: 'error', text: (err && err.message) ? String(err.message) : '调用模型失败' })
          } finally {
            setBusy(false)
          }
        }

        const icon = React.createElement('svg', {
          width: 14, height: 14, viewBox: '0 0 24 24',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        },
          React.createElement('path', { d: 'M12 3 L14.4 9.6 L21 12 L14.4 14.4 L12 21 L9.6 14.4 L3 12 L9.6 9.6 Z' }),
          React.createElement('path', { d: 'M18.5 3.5 L19.2 5.8 L21.5 6.5 L19.2 7.2 L18.5 9.5 L17.8 7.2 L15.5 6.5 L17.8 5.8 Z' }),
        )

        let content = icon
        let color
        if (state && state.kind === 'ok') {
          content = React.createElement('svg', {
            width: 14, height: 14, viewBox: '0 0 24 24',
            fill: 'none', stroke: 'currentColor', strokeWidth: 2.4,
            strokeLinecap: 'round', strokeLinejoin: 'round',
          }, React.createElement('path', { d: 'M5 13 L10 18 L19 6' }))
          color = 'var(--dsw-alias-state-success-primary)'
        } else if (state && state.kind === 'error') {
          color = 'var(--dsw-alias-state-error-primary)'
        }

        return React.createElement('button', {
          type: 'button',
          className: 'dsh-pdeepen' + (busy ? ' dsh-pdeepen-spin' : ''),
          title: busy ? '正在深化提示词…' : ((state && state.kind === 'error') ? state.text : '深化并优化提示词'),
          'aria-label': '深化并优化提示词',
          disabled: busy,
          onClick: onClick,
          style: color ? { color } : undefined,
        }, content)
      },
    ))
  },
}