/**
 * Git management panel. Registered in shell.overlay (the panel body),
 * sidebar.footer.action (the sidebar toggle), and conversation.input.left
 * (the input toggle) — all three share one open-state store.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createGitPanelStore } from './git-panel-store.ts'
import type {
  GitActionResult,
  GitBranchListResult,
  GitBranchRequest,
  GitCheckoutRequest,
  GitCleanRequest,
  GitCommitRequest,
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
import css from './GitPanel.module.css'

/** Registration-side remote face used by the panel and its toggles. */
export interface GitPanelInjected {
  /** Panel bootstrap: status + log + branches + config. */
  panelState: (args: GitRepoRequest) => Promise<GitPanelStateResult>
  stage: (args: GitStageRequest) => Promise<GitActionResult>
  unstage: (args: GitStageRequest) => Promise<GitActionResult>
  commit: (args: GitCommitRequest) => Promise<GitActionResult>
  commitMessage: (args: GitRepoRequest) => Promise<GitActionResult>
  show: (args: GitShowRequest) => Promise<GitTextResult>
  diff: (args: GitDiffRequest) => Promise<GitTextResult>
  log: (args: GitLogRequest) => Promise<GitTextResult>
  branch: (args: GitBranchRequest) => Promise<GitBranchListResult | GitActionResult>
  checkout: (args: GitCheckoutRequest) => Promise<GitActionResult>
  pull: (args: GitPullRequest) => Promise<GitActionResult>
  push: (args: GitPushRequest) => Promise<GitActionResult>
  reset: (args: GitResetRequest) => Promise<GitActionResult>
  clean: (args: GitCleanRequest) => Promise<GitActionResult>
  stash: (args: GitStashRequest) => Promise<GitActionResult>
}

/** Toggle-only face for the sidebar and input buttons. */
export interface GitPanelToggleInjected {
  /** Toggle the panel open state. */
  toggle: () => void
}

/** Full component props assembled by the overlay slot renderer. */
export type GitPanelProps =
  PropsRuntime<'shell.overlay'> & PropsStore<ReturnType<typeof createGitPanelStore>> & InjectFace<GitPanelInjected>

/** Sidebar footer toggle button props. */
export type SidebarGitButtonProps =
  PropsRuntime<'sidebar.footer.action'> & PropsStore<ReturnType<typeof createGitPanelStore>> & InjectFace<GitPanelToggleInjected>

/** Input-row toggle button props. */
export type InputGitButtonProps =
  PropsRuntime<'conversation.input.left'> & PropsStore<ReturnType<typeof createGitPanelStore>> & InjectFace<GitPanelToggleInjected>

type TabId = 'changes' | 'commit' | 'history' | 'branch' | 'more'

/** The overlay Git panel. */
export function GitPanel(props: GitPanelProps): ReactNode {
  const {
    useStore, actions, panelState, stage, unstage, commit, commitMessage, show, diff,
    branch, checkout, pull, push, reset, clean, stash,
  } = props
  const open = useStore(s => s.open)
  const sessionCwd = props.useSessions((s) => {
    const cur = s.current !== undefined ? s.byId[s.current] : undefined
    return cur?.cwd
  })
  const [repoPath, setRepoPath] = useState('')
  const [tab, setTab] = useState<TabId>('changes')
  const [data, setData] = useState<GitPanelStateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [diffText, setDiffText] = useState('')
  const [diffLabel, setDiffLabel] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; desc: string; action: () => Promise<unknown> } | null>(null)
  const [newBranch, setNewBranch] = useState('')

  useEffect(() => {
    if (!repoPath && sessionCwd) setRepoPath(sessionCwd)
  }, [sessionCwd])

  if (!open) return null

  const refresh = async (): Promise<void> => {
    if (!repoPath.trim()) { setError('请填写仓库目录（默认取当前会话工作目录）'); return }
    setLoading(true)
    setError('')
    try {
      const res = await panelState({ repoPath: repoPath.trim() })
      setData(res)
      setDiffText('')
    } catch (err) {
      setError(String((err instanceof Error && err.message) || err))
    } finally {
      setLoading(false)
    }
  }

  const run = async (
    method: (args: never) => Promise<GitActionResult | GitBranchListResult>,
    args: object,
    after?: () => void,
  ): Promise<GitActionResult | GitBranchListResult | null> => {
    if (!repoPath.trim()) { setError('请填写仓库目录'); return null }
    setBusy(true)
    setError('')
    try {
      const res = await method({ repoPath: repoPath.trim(), ...args } as never)
      if (res.ok) {
        if (after) after()
        void refresh()
      } else {
        setError(res.error)
      }
      return res
    } catch (err) {
      setError(String((err instanceof Error && err.message) || err))
      return null
    } finally {
      setBusy(false)
    }
  }

  const viewDiff = async (path: string, staged: boolean): Promise<void> => {
    if (!repoPath.trim()) return
    setDiffLabel(`${staged ? '已暂存' : '工作区'} ${path}`)
    setDiffLoading(true)
    setError('')
    try {
      const res = await diff({ repoPath: repoPath.trim(), staged, path })
      setDiffText(res.ok ? res.text : '')
    } catch (err) {
      setError(String((err instanceof Error && err.message) || err))
    } finally {
      setDiffLoading(false)
    }
  }

  const viewCommit = async (commitHash: string): Promise<void> => {
    if (!repoPath.trim()) return
    setDiffLabel(`提交 ${commitHash}`)
    setDiffLoading(true)
    setError('')
    try {
      const res = await show({ repoPath: repoPath.trim(), commit: commitHash })
      setDiffText(res.ok ? res.text : '')
    } catch (err) {
      setError(String((err instanceof Error && err.message) || err))
    } finally {
      setDiffLoading(false)
    }
  }

  const s = data?.ok === true ? data.status : null
  const notARepo = data?.ok === true ? data.notARepo : undefined

  const stagedFiles = s?.staged ?? []
  const unstagedFiles = s?.unstaged ?? []
  const untrackedFiles = s?.untracked ?? []
  const conflictFiles = s?.conflicts ?? []
  const allStaged = stagedFiles.map(x => x.path)
  const allUnstaged = [...unstagedFiles, ...untrackedFiles].map(x => x.path)

  const fileRow = (f: { path: string; staged: boolean; conflict: boolean }): ReactNode => (
    <div key={f.path} className={css.file + (f.conflict ? ' ' + css.conflict : '')}
      onClick={() => void viewDiff(f.path, f.staged)}>
      <span className={css.name}>{f.conflict ? '⚠ ' : ''}{f.path}</span>
      <button type="button" className={css.mini} disabled={busy}
        onClick={(ev) => { ev.stopPropagation(); void run(f.staged ? unstage : stage, { paths: [f.path] }) }}>
        {f.staged ? '取消暂存' : '暂存'}
      </button>
    </div>
  )

  const changesTab = (): ReactNode => {
    if (s === null) {
      if (loading) return <div className={css.empty}>加载中…</div>
      if (notARepo) {
        return (
          <div>
            <div className={css.err}>{`⚠ ${notARepo}`}</div>
            <div className={css.empty}>请在顶部填写 git 仓库目录后点「刷新」</div>
          </div>
        )
      }
      return <div className={css.empty}>点击「刷新」读取仓库状态</div>
    }
    if (s.clean && conflictFiles.length === 0) return <div className={css.empty}>工作区干净 ✓</div>
    return (
      <div>
        {conflictFiles.length > 0 ? (
          <div>
            <div className={css.group}>{`冲突 (${conflictFiles.length})`}</div>
            {conflictFiles.map(f => fileRow({ path: f.path, staged: false, conflict: true }))}
          </div>
        ) : null}
        <div>
          <div className={css.group}>{`已暂存 (${stagedFiles.length})`}</div>
          {stagedFiles.length > 0 ? (
            <div className={css.rowline}>
              <button type="button" className={css.btn} disabled={busy} onClick={() => void run(unstage, { paths: allStaged })}>全部取消暂存</button>
            </div>
          ) : null}
          {stagedFiles.map(f => fileRow({ path: f.path, staged: true, conflict: false }))}
        </div>
        <div>
          <div className={css.group}>{`未暂存 (${unstagedFiles.length})`}</div>
          {unstagedFiles.map(f => fileRow({ path: f.path, staged: false, conflict: false }))}
        </div>
        <div>
          <div className={css.group}>{`未跟踪 (${untrackedFiles.length})`}</div>
          {untrackedFiles.length > 0 ? (
            <div className={css.rowline}>
              <button type="button" className={css.btn} disabled={busy} onClick={() => void run(stage, { paths: allUnstaged })}>全部暂存</button>
            </div>
          ) : null}
          {untrackedFiles.map(f => fileRow({ path: f.path, staged: false, conflict: false }))}
        </div>
        {diffLabel ? (
          <div>
            <div className={css.group}>{diffLabel}</div>
            {diffLoading ? <div className={css.empty}>加载 diff…</div> : <pre className={css.diff}>{diffText || '(无内容)'}</pre>}
          </div>
        ) : null}
      </div>
    )
  }

  const commitTab = (): ReactNode => (
    <div>
      <textarea className={css.msg} placeholder="提交信息（第一行为主题）" value={message}
        onChange={(ev) => { setMessage(ev.target.value) }} />
      <div className={css.rowline + ' ' + css.toolbar}>
        <button type="button" className={css.btn} disabled={generating || busy}
          onClick={() => {
            setGenerating(true)
            setError('')
            void commitMessage({ repoPath: repoPath.trim() })
              .then((res) => {
                if (res.ok) setMessage(res.message)
                else setError(res.error)
              })
              .catch(err => setError(String((err instanceof Error && err.message) || err)))
              .finally(() => setGenerating(false))
          }}>
          {generating ? '生成中…' : 'AI 生成提交信息'}
        </button>
        <button type="button" className={css.btn + ' ' + css.primary} disabled={busy || !message.trim()}
          onClick={() => {
            if (!message.trim()) { setError('提交信息不能为空'); return }
            void run(commit, { message: message.trim() }, () => setMessage(''))
          }}>
          提交
        </button>
      </div>
      <div className={css.hint}>AI 生成基于暂存区 diff，使用 Conventional Commits 格式（默认 tokenrhythm/qwen3.8-max，可在设置页「Git 管理」配置 commitModel）。</div>
    </div>
  )

  const historyTab = (): ReactNode => {
    const rows = data?.ok === true && data.log ? data.log : []
    if (rows.length === 0) return <div className={css.empty}>（无提交记录）</div>
    return (
      <div>
        {rows.map(row => (
          <div key={row.hash} className={css.logrow} onClick={() => void viewCommit(row.hash)}>
            <span className={css.hash}>{row.hash}</span>
            <span className={css.subj}>{row.subject}</span>
            <span className={css.meta}>{`${row.author} · ${row.date}`}</span>
          </div>
        ))}
      </div>
    )
  }

  const branchTab = (): ReactNode => {
    const branches = data?.ok === true ? data.branches : []
    return (
      <div>
        <div className={css.rowline}>
          <input className={css.repo + ' ' + css.flex} placeholder="新分支名" value={newBranch}
            onChange={(ev) => { setNewBranch(ev.target.value) }} />
          <button type="button" className={css.btn + ' ' + css.primary} disabled={busy || !newBranch.trim()}
            onClick={() => {
              if (!newBranch.trim()) { setError('分支名不能为空'); return }
              void run(branch, { action: 'create', name: newBranch.trim() }, () => setNewBranch(''))
            }}>
            新建
          </button>
        </div>
        <div className={css.branchList}>
          {branches.map(b => (
            <div key={b.name} className={css.brow}>
              <span className={css.name + (b.current ? ' ' + css.cur : '')}
                onClick={() => { if (!b.current) void run(checkout, { target: b.name }) }}
                style={b.current ? {} : { cursor: 'pointer' }}>
                {`${b.current ? '● ' : ''}${b.name}${b.upstream ? ` → ${b.upstream}` : ''}`}
              </span>
              {b.current ? null : (
                <button type="button" className={css.mini} disabled={busy}
                  onClick={() => setConfirm({
                    title: '删除分支',
                    desc: `删除分支 ${b.name}？`,
                    action: () => run(branch, { action: 'delete', name: b.name, confirm: true }),
                  })}>
                  删除
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const moreTab = (): ReactNode => (
    <div>
      <div className={css.group}>同步</div>
      <div className={css.rowline}>
        <button type="button" className={css.btn} disabled={busy} onClick={() => void run(pull, {})}>拉取 pull</button>
        <button type="button" className={css.btn} disabled={busy} onClick={() => void run(push, {})}>推送 push</button>
        <button type="button" className={css.btn + ' ' + css.danger} disabled={busy}
          onClick={() => setConfirm({
            title: '强制推送',
            desc: 'git push --force 会覆盖远端历史，确定？',
            action: () => run(push, { force: true, confirm: true }),
          })}>
          强制推送
        </button>
      </div>
      <div className={css.group}>回滚</div>
      <div className={css.rowline}>
        <button type="button" className={css.btn} disabled={busy} onClick={() => void run(reset, { mode: 'soft' })}>reset --soft</button>
        <button type="button" className={css.btn} disabled={busy} onClick={() => void run(reset, { mode: 'mixed' })}>reset --mixed</button>
        <button type="button" className={css.btn + ' ' + css.danger} disabled={busy}
          onClick={() => setConfirm({
            title: '重置 (hard)',
            desc: 'git reset --hard 会丢弃所有未提交改动（不可恢复），确定？',
            action: () => run(reset, { mode: 'hard', confirm: true }),
          })}>
          reset --hard
        </button>
      </div>
      <div className={css.group}>清理</div>
      <div className={css.rowline}>
        <button type="button" className={css.btn} disabled={busy} onClick={() => void run(clean, { dryRun: true })}>clean 预览</button>
        <button type="button" className={css.btn + ' ' + css.danger} disabled={busy}
          onClick={() => setConfirm({
            title: '清理未跟踪文件',
            desc: 'git clean -fd 会删除所有未跟踪文件（不可恢复），确定？',
            action: () => run(clean, { dryRun: false, confirm: true }),
          })}>
          clean 执行
        </button>
      </div>
      <div className={css.group}>stash</div>
      <div className={css.rowline}>
        <button type="button" className={css.btn} disabled={busy} onClick={() => void run(stash, { action: 'push', message: 'dsh-git 面板' })}>stash push</button>
        <button type="button" className={css.btn} disabled={busy} onClick={() => void run(stash, { action: 'pop' })}>stash pop</button>
        <button type="button" className={css.btn} disabled={busy} onClick={() => void run(stash, { action: 'list' })}>stash list</button>
      </div>
    </div>
  )

  const tabs: { id: TabId; label: string }[] = [
    { id: 'changes', label: '变更' },
    { id: 'commit', label: '提交' },
    { id: 'history', label: '历史' },
    { id: 'branch', label: '分支' },
    { id: 'more', label: '更多' },
  ]

  const body = tab === 'changes' ? changesTab()
    : tab === 'commit' ? commitTab()
      : tab === 'history' ? historyTab()
        : tab === 'branch' ? branchTab()
          : moreTab()

  const confirmModal = confirm ? (
    <div className={css.overlayMask} onClick={(ev) => { if (ev.target === ev.currentTarget) setConfirm(null) }}>
      <div className={css.modal} onClick={ev => ev.stopPropagation()}>
        <p className={css.modalTitle}>{confirm.title}</p>
        <p className={css.modalDesc}>{confirm.desc}</p>
        <div className={css.modalRow}>
          <button type="button" className={css.btn} disabled={busy} onClick={() => setConfirm(null)}>取消</button>
          <button type="button" className={css.btn + ' ' + css.danger} disabled={busy}
            onClick={() => { const act = confirm.action; setConfirm(null); void act() }}>
            确认
          </button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div className={css.panel}>
      <div className={css.head}>
        <h3 className={css.title}>Git 面板</h3>
        <input className={css.repo} placeholder="仓库目录（默认当前会话工作目录）" value={repoPath}
          onChange={(ev) => { setRepoPath(ev.target.value) }} />
        <button type="button" className={css.btn} disabled={loading} onClick={() => void refresh()}>{loading ? '…' : '刷新'}</button>
        <button type="button" className={css.btn} onClick={() => actions.close()}>✕</button>
      </div>
      {s !== null ? (
        <div className={css.status}>
          <span className={css.branch}>{s.head || '(无分支)'}</span>
          {s.upstream ? <span>{`↑${s.ahead} ↓${s.behind}`}</span> : null}
          <span>{`冲突 ${s.conflicts.length}`}</span>
          <span>{`已暂存 ${s.staged.length}`}</span>
          <span>{`未暂存 ${s.unstaged.length}`}</span>
          <span>{`未跟踪 ${s.untracked.length}`}</span>
        </div>
      ) : null}
      <div className={css.tabs}>
        {tabs.map(t => (
          <button key={t.id} type="button" className={css.tab + (tab === t.id ? ' ' + css.active : '')}
            onClick={() => { setTab(t.id) }}>
            {t.label}
          </button>
        ))}
      </div>
      <div className={css.body}>
        {error ? <div className={css.err}>{error}</div> : null}
        {body}
      </div>
      {confirmModal}
    </div>
  )
}

/** Sidebar footer toggle button. */
export function SidebarGitButton(props: SidebarGitButtonProps): ReactNode {
  const { toggle, wide } = props
  return (
    <button type="button" className={css.sidebarBtn} title="Git 面板" onClick={() => toggle()}>
      {wide ? 'Git' : '⑂'}
    </button>
  )
}

/** Composer input-row toggle button. */
export function InputGitButton(props: InputGitButtonProps): ReactNode {
  const { toggle } = props
  return (
    <button type="button" className={css.inputBtn} title="Git 面板" onClick={() => toggle()}>
      {'⑂ Git'}
    </button>
  )
}
