/**
 * Wire vocabulary for the dsh-git Remote gateway, its settings page, and the
 * Git panel. All types are plain JSON — they cross the Client→Host Remote
 * boundary and the typert generator derives codecs from them.
 * @module @deepseek-ai/dsh-git/types
 */

/** Durable plugin configuration stored in the `dsh-git` settings namespace. */
export interface GitSettings {
  /** Route used by AI commit-message generation. */
  readonly commitModel: {
    readonly provider: string
    readonly model: string
  }
  /** Reserved auto-refresh interval (ms); the panel refreshes manually today. */
  readonly autoRefreshMs: number
}

/** One porcelain v2 file entry (staged/unstaged/untracked/conflict). */
export interface GitFileEntry {
  readonly xy: string
  readonly path: string
  readonly x: string
  readonly y: string
  readonly orig?: string
}

/** Parsed `git status --porcelain=v2 -b` view. */
export interface GitStatusView {
  readonly root: string
  readonly head: string
  readonly upstream: string
  readonly ahead: number
  readonly behind: number
  readonly staged: readonly GitFileEntry[]
  readonly unstaged: readonly GitFileEntry[]
  readonly untracked: readonly GitFileEntry[]
  readonly conflicts: readonly GitFileEntry[]
  readonly clean: boolean
}

/** One `git log` row (`%h|%an|%ad|%s`). */
export interface GitLogRow {
  readonly hash: string
  readonly author: string
  readonly date: string
  readonly subject: string
}

/** One `git branch --format=...` row. */
export interface GitBranchRow {
  readonly name: string
  readonly current: boolean
  readonly upstream: string
}

/** Common error-carrying envelope for every Remote method. */
export interface GitErrorEnvelope {
  readonly ok: false
  readonly error: string
}

/** Panel bootstrap: status + recent log + branches + active config. */
export interface GitPanelStateResultOk {
  readonly ok: true
  /** Parsed status, or null when the cwd is not a git repo. */
  readonly status: GitStatusView | null
  /** Friendly message when `status` is null (not a repo / missing dir). */
  readonly notARepo?: string
  readonly log: readonly GitLogRow[]
  readonly branches: readonly GitBranchRow[]
  readonly commitModel: { readonly provider: string; readonly model: string }
}

/** Panel bootstrap: status + recent log + branches + active config. */
export type GitPanelStateResult = GitPanelStateResultOk | GitErrorEnvelope

/** Generic action outcome (`stage`/`unstage`/`commit`/...). */
export type GitActionResult = { readonly ok: true; readonly message: string } | GitErrorEnvelope

/** Textual diff/show/log payload. */
export type GitTextResult = { readonly ok: true; readonly text: string } | GitErrorEnvelope

/** Branch list payload. */
export type GitBranchListResult =
  | { readonly ok: true; readonly branches: readonly GitBranchRow[] }
  | GitErrorEnvelope

/** Config read for the settings page. */
export type GitConfigResult = { readonly ok: true; readonly config: GitSettings } | GitErrorEnvelope

/** Request payloads (each Remote method takes one plain object). */

export interface GitRepoRequest {
  readonly repoPath: string
}

export interface GitStageRequest extends GitRepoRequest {
  readonly paths: readonly string[]
}

export interface GitCommitRequest extends GitRepoRequest {
  readonly message: string
  readonly amend?: boolean
}

export interface GitShowRequest extends GitRepoRequest {
  readonly commit: string
}

export interface GitDiffRequest extends GitRepoRequest {
  readonly staged?: boolean
  readonly path?: string
}

export interface GitLogRequest extends GitRepoRequest {
  readonly n?: number
}

export interface GitBranchRequest extends GitRepoRequest {
  readonly action: 'list' | 'create' | 'switch' | 'delete'
  readonly name?: string
  readonly from?: string
  readonly create?: boolean
  readonly force?: boolean
  readonly confirm?: boolean
}

export interface GitCheckoutRequest extends GitRepoRequest {
  readonly target: string
  readonly create?: boolean
  readonly force?: boolean
  readonly confirm?: boolean
}

export interface GitPullRequest extends GitRepoRequest {
  readonly rebase?: boolean
  readonly remote?: string
  readonly branch?: string
}

export interface GitPushRequest extends GitRepoRequest {
  readonly setUpstream?: boolean
  readonly force?: boolean
  readonly confirm?: boolean
  readonly remote?: string
  readonly branch?: string
}

export interface GitResetRequest extends GitRepoRequest {
  readonly mode: 'soft' | 'mixed' | 'hard'
  readonly target?: string
  readonly confirm?: boolean
}

export interface GitCleanRequest extends GitRepoRequest {
  readonly dryRun: boolean
  readonly confirm?: boolean
}

export interface GitStashRequest extends GitRepoRequest {
  readonly action: 'list' | 'push' | 'pop' | 'apply' | 'drop' | 'clear'
  readonly message?: string
  readonly confirm?: boolean
}

export interface GitConfigPatch {
  readonly commitModel: { readonly provider: string; readonly model: string }
  readonly autoRefreshMs: number
}
