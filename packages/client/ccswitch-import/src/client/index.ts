/** Browser half of the CCSwitch import plugin: the Settings import page. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  CcswitchImportRequest,
  CcswitchImportResult,
  CcswitchListResult,
} from '@deepseek-ai/dsh-ccswitch-import/types'
import { SectionView, type SectionViewInjected } from './SectionView.tsx'

export type { SectionViewInjected } from './SectionView.tsx'

/** Services required by the Settings registration and the generated Remote face. */
export const inject = ['slots', 'remote', 'remote.ccswitch']

/** Contribute the import page to the Settings sections. */
export function apply(ctx: ClientContext): void {
  const injected = (): SectionViewInjected => ({
    list: async (): Promise<CcswitchListResult> => {
      const result = await ctx.remote.ccswitch.list()
      if (!result.ok) {
        throw new Error(`ccswitch.list failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
    import: async (request: CcswitchImportRequest): Promise<CcswitchImportResult> => {
      const result = await ctx.remote.ccswitch.import(request)
      if (!result.ok) {
        throw new Error(`ccswitch.import failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'ccswitch-import',
    order: 25,
    label: () => 'CCSwitch 导入',
    inject: injected,
  }, SectionView))
}
