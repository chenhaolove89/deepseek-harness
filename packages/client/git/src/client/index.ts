/**
 * Browser half of the dsh-git plugin: the Git panel (sidebar footer action,
 * composer input action, overlay) and the Git settings page. All git work
 * happens on the Host through the generated `remote.git` face.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  GitActionResult,
  GitBranchListResult,
  GitBranchRequest,
  GitCheckoutRequest,
  GitCleanRequest,
  GitCommitRequest,
  GitConfigPatch,
  GitConfigResult,
  GitDiffRequest,
  GitLogRequest,
  GitPanelStateResult,
  GitPullRequest,
  GitPushRequest,
  GitRepoRequest,
  GitResetRequest,
  GitShowRequest,
  GitStageRequest,
  GitStashRequest,
  GitTextResult,
} from '@deepseek-ai/dsh-git/types'
import {
  GitPanel, InputGitButton, SidebarGitButton,
  type GitPanelInjected, type GitPanelToggleInjected,
} from './GitPanel.tsx'
import { GitSettings, type GitSettingsInjected } from './GitSettings.tsx'
import { createGitPanelStore } from './git-panel-store.ts'

export type { GitPanelInjected, GitPanelToggleInjected } from './GitPanel.tsx'
export type { GitSettingsInjected } from './GitSettings.tsx'
export type { GitPanelActions, GitPanelState } from './git-panel-store.ts'

/** Services required by the panel/settings registrations and the generated Remote face. */
export const inject = ['slots', 'remote', 'remote.git']

/** Unwrap one RemoteResult; a transport failure throws. */
function unwrap<T>(method: string, result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) {
    throw new Error(`${method} failed: ${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

/** Build the injected face the Git panel consumes. */
function gitPanelInjected(ctx: ClientContext): GitPanelInjected {
  return {
    panelState: async (args: GitRepoRequest): Promise<GitPanelStateResult> =>
      unwrap('git.panelState', await ctx.remote.git.panelState(args)),
    stage: async (args: GitStageRequest): Promise<GitActionResult> =>
      unwrap('git.stage', await ctx.remote.git.stage(args)),
    unstage: async (args: GitStageRequest): Promise<GitActionResult> =>
      unwrap('git.unstage', await ctx.remote.git.unstage(args)),
    commit: async (args: GitCommitRequest): Promise<GitActionResult> =>
      unwrap('git.commit', await ctx.remote.git.commit(args)),
    commitMessage: async (args: GitRepoRequest): Promise<GitActionResult> =>
      unwrap('git.commitMessage', await ctx.remote.git.commitMessage(args)),
    show: async (args: GitShowRequest): Promise<GitTextResult> =>
      unwrap('git.show', await ctx.remote.git.show(args)),
    diff: async (args: GitDiffRequest): Promise<GitTextResult> =>
      unwrap('git.diff', await ctx.remote.git.diff(args)),
    log: async (args: GitLogRequest): Promise<GitTextResult> =>
      unwrap('git.log', await ctx.remote.git.log(args)),
    branch: async (args: GitBranchRequest): Promise<GitBranchListResult | GitActionResult> =>
      unwrap('git.branch', await ctx.remote.git.branch(args)),
    checkout: async (args: GitCheckoutRequest): Promise<GitActionResult> =>
      unwrap('git.checkout', await ctx.remote.git.checkout(args)),
    pull: async (args: GitPullRequest): Promise<GitActionResult> =>
      unwrap('git.pull', await ctx.remote.git.pull(args)),
    push: async (args: GitPushRequest): Promise<GitActionResult> =>
      unwrap('git.push', await ctx.remote.git.push(args)),
    reset: async (args: GitResetRequest): Promise<GitActionResult> =>
      unwrap('git.reset', await ctx.remote.git.reset(args)),
    clean: async (args: GitCleanRequest): Promise<GitActionResult> =>
      unwrap('git.clean', await ctx.remote.git.clean(args)),
    stash: async (args: GitStashRequest): Promise<GitActionResult> =>
      unwrap('git.stash', await ctx.remote.git.stash(args)),
  }
}

/** Build the injected face the Git settings page consumes. */
function gitSettingsInjected(ctx: ClientContext): GitSettingsInjected {
  return {
    getConfig: async (): Promise<GitConfigResult> =>
      unwrap('git.getConfig', await ctx.remote.git.getConfig()),
    setConfig: async (config: GitConfigPatch): Promise<GitActionResult> =>
      unwrap('git.setConfig', await ctx.remote.git.setConfig(config)),
  }
}

/** Contribute the Git panel entries and the Git settings page. */
export function apply(ctx: ClientContext): void {
  const store = createGitPanelStore()
  const panelInjected = (): GitPanelInjected => gitPanelInjected(ctx)
  const rootToggleInjected = (actions: BoundActions<typeof store>): GitPanelToggleInjected => ({
    toggle: () => { actions.toggle() },
  })
  const sessionToggleInjected = (_sessionId: unknown, actions: BoundActions<typeof store>): GitPanelToggleInjected => ({
    toggle: () => { actions.toggle() },
  })
  const settingsInjected = (): GitSettingsInjected => gitSettingsInjected(ctx)

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'git-panel',
    order: 20,
    store,
    inject: rootToggleInjected,
  }, SidebarGitButton))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'git-panel-input',
    order: 20,
    store,
    inject: sessionToggleInjected,
  }, InputGitButton))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'git-panel-overlay',
    order: 20,
    store,
    inject: panelInjected,
  }, GitPanel))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-git',
    order: 30,
    label: () => 'Git 管理',
    inject: settingsInjected,
  }, GitSettings))
}
