/** Browser half of the Prompt Deepen plugin: the composer Deepen button. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PromptDeepenRequest, PromptDeepenResult } from '@deepseek-ai/dsh-prompt-deepen/types'
import { DeepenButton, type DeepenButtonInjected } from './DeepenButton.tsx'

export type { DeepenButtonInjected } from './DeepenButton.tsx'

/** Services required by the composer registration and the generated Remote face. */
export const inject = ['slots', 'remote', 'remote.promptDeepen']

/** Contribute the Deepen button to the composer tool row. */
export function apply(ctx: ClientContext): void {
  const injected = (): DeepenButtonInjected => ({
    deepen: async (request: PromptDeepenRequest): Promise<PromptDeepenResult> => {
      const result = await ctx.remote.promptDeepen.deepen(request)
      if (!result.ok) {
        throw new Error(`promptDeepen.deepen failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
  })

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'prompt-deepen',
    order: 0,
    inject: injected,
  }, DeepenButton))
}
