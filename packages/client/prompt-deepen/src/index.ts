/**
 * Prompt Deepen: deepen the composer draft with the current model.
 * @module @deepseek-ai/dsh-prompt-deepen
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { PromptDeepenRequest, PromptDeepenResult } from '@deepseek-ai/dsh-prompt-deepen/types'

export type { PromptDeepenRequest, PromptDeepenResult } from '@deepseek-ai/dsh-prompt-deepen/types'

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

/** Remote gateway serving the composer Deepen button. */
export class PromptDeepenGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'promptDeepen')
  }

  /** Deepen the given draft prompt with the currently selected model. */
  @Remote('deepen')
  async deepen(args: PromptDeepenRequest): Promise<PromptDeepenResult> {
    const text = String(args?.text ?? '').trim()
    if (!text) return { ok: false, error: '输入框为空，请先编写提示词' }
    const llm = this.ctx.get('llm')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (llm === undefined) return { ok: false, error: 'llm 服务不可用' }
    if (defaultModel === undefined) return { ok: false, error: '模型服务不可用' }
    const selection = defaultModel.currentSelection()
    if (!selection?.provider || !selection.model) {
      return { ok: false, error: '当前未配置模型，请先在模型选择中选定模型' }
    }
    const parts: string[] = []
    try {
      const stream = llm.stream({
        provider: selection.provider,
        model: selection.model,
        messages: [createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        })],
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
    } catch (error) {
      return { ok: false, error: (error instanceof Error && error.message) ? error.message : String(error) }
    }
    const result = parts.join('').trim()
    if (!result) return { ok: false, error: '模型未返回内容，请重试' }
    return { ok: true, text: result }
  }
}

export const name = 'prompt-deepen'
export const inject = ['llm', 'agentDefaultModel']

/** Register the Remote gateway. */
export function apply(ctx: Context): void {
  new PromptDeepenGateway(ctx)
}
