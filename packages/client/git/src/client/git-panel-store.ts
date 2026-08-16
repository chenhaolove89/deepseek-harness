/**
 * Git panel shared open-state store. One handle registered on the sidebar
 * button, the input button, and the overlay panel, so all three share the
 * panel's open/close state.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Store state: whether the Git panel overlay is open. */
export interface GitPanelState {
  open: boolean
}

/** Declared action shape giving the exported factory a stable return type. */
export type GitPanelActions = {
  /** Open the panel. */
  open: (draft: GitPanelState) => void
  /** Close the panel. */
  close: (draft: GitPanelState) => void
  /** Toggle the panel. */
  toggle: (draft: GitPanelState) => void
}

/**
 * Declares the Git panel open state and its write surface.
 * @returns the store handle shared by the panel entries.
 */
export function createGitPanelStore(): EngineStoreHandle<GitPanelState, GitPanelActions> {
  return defineStore({
    init: (): GitPanelState => ({ open: false }),
    actions: {
      open: (d) => { d.open = true },
      close: (d) => { d.open = false },
      toggle: (d) => { d.open = !d.open },
    },
  })
}
