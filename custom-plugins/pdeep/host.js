return {
  apply(ctx) {
    const llm = ctx.get('llm')
    const defaultModel = ctx.get('agentDefaultModel')
    if (llm === undefined || defaultModel === undefined) return

    const SYSTEM = [
      '你是一位资深的提示词工程专家（prompt engineer）。',
      '用户会提供一段草稿提示词，请你对其进行深化与优化。要求：',
      '1. 明确角色、目标与任务，让模型清楚自己要做什么；',
      '2. 补充必要的上下文、约束条件与边界；',
      '3. 将复杂任务拆解为清晰、有序的步骤；',
      '4. 指定输出格式、长度与质量标准；',
      '5. 用词具体、可执行、可验证，避免空泛；',
      '6. 始终保留用户的原始意图，不改变主题与目标。',
      '直接输出优化后的提示词正文，不要任何解释、前缀、后缀或代码块包裹。',
    ].join('\n')

    let seq = 0
    harness.handle('prompt-deepen', async (args) => {
      const text = String((args && args.text) || '').trim()
      if (!text) return { ok: false, error: '输入框为空，请先编写提示词' }
      const selection = defaultModel.currentSelection()
      if (!selection || !selection.provider || !selection.model) {
        return { ok: false, error: '当前未配置模型，请先在模型选择中选定模型' }
      }
      const parts = []
      try {
        const stream = llm.stream({
          provider: selection.provider,
          model: selection.model,
          messages: [{
            id: 'pdeepen-' + (++seq),
            role: 'user',
            content: [{ type: 'text', text }],
            source: { kind: 'user' },
          }],
          system: SYSTEM,
          temperature: 0.7,
          maxTokens: 4096,
        })
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') parts.push(chunk.text)
          else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
            return { ok: false, error: chunk.reason.failure.message }
          } else if (chunk.type === 'finish' && chunk.reason.kind === 'aborted') {
            return { ok: false, error: chunk.reason.failure.message }
          }
        }
      } catch (err) {
        return { ok: false, error: (err && err.message) ? String(err.message) : String(err) }
      }
      const result = parts.join('').trim()
      if (!result) return { ok: false, error: '模型未返回内容，请重试' }
      return { ok: true, text: result }
    })
  },
}