return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(`.gitp-panel{position:fixed;top:0;right:0;bottom:0;width:min(560px,calc(100vw - 80px));background:var(--dsw-alias-bg-layer-1,#fff);border-left:1px solid var(--dsw-alias-border-l1,#e5e6eb);display:flex;flex-direction:column;z-index:1200;box-shadow:-8px 0 32px rgba(0,0,0,.12);pointer-events:auto}
.gitp-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e6eb)}
.gitp-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329);margin:0;white-space:nowrap}
.gitp-repo{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2,#d0d3d9);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.gitp-btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,#d0d3d9);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2329);border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;white-space:nowrap}
.gitp-btn:hover{border-color:var(--dsw-alias-brand-primary,#3370ff);color:var(--dsw-alias-brand-primary,#3370ff)}
.gitp-btn.primary{background:var(--dsw-alias-button-primary-fill,#3370ff);border-color:var(--dsw-alias-button-primary-fill,#3370ff);color:var(--dsw-alias-label-primary-foreground,#fff)}
.gitp-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,#2b5fd9);color:var(--dsw-alias-label-primary-foreground,#fff)}
.gitp-btn.danger{border-color:var(--dsw-alias-state-error-primary,#f53f3f);color:var(--dsw-alias-state-error-primary,#f53f3f)}
.gitp-btn:disabled{opacity:.5;cursor:not-allowed}
.gitp-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e6eb);font-size:12px;color:var(--dsw-alias-label-secondary,#646a73)}
.gitp-branch{font-weight:600;color:var(--dsw-alias-label-primary,#1f2329)}
.gitp-tabs{display:flex;gap:2px;padding:6px 10px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e6eb)}
.gitp-tab{border:none;background:none;padding:7px 12px;font-size:13px;color:var(--dsw-alias-label-secondary,#646a73);cursor:pointer;border-bottom:2px solid transparent}
.gitp-tab.active{color:var(--dsw-alias-brand-primary,#3370ff);border-bottom-color:var(--dsw-alias-brand-primary,#3370ff);font-weight:600}
.gitp-body{flex:1;overflow:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px}
.gitp-group{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#646a73);margin:6px 0 2px}
.gitp-file{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-primary,#1f2329)}
.gitp-file:hover{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.gitp-file .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;word-break:break-all}
.gitp-file.conflict{color:var(--dsw-alias-state-error-primary,#f53f3f)}
.gitp-file .mini{border:1px solid var(--dsw-alias-border-l2,#d0d3d9);background:none;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary,#646a73)}
.gitp-file .mini:hover{border-color:var(--dsw-alias-brand-primary,#3370ff);color:var(--dsw-alias-brand-primary,#3370ff)}
.gitp-diff{flex:1;min-height:120px;overflow:auto;background:var(--dsw-alias-bg-layer-2,#f7f8fa);border:1px solid var(--dsw-alias-border-l1,#e5e6eb);border-radius:6px;padding:10px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-primary,#1f2329);white-space:pre}
.gitp-msg{width:100%;min-height:90px;border:1px solid var(--dsw-alias-border-l2,#d0d3d9);border-radius:6px;padding:8px 10px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-layer-1,#fff);resize:vertical;box-sizing:border-box}
.gitp-logrow{display:flex;gap:8px;align-items:baseline;padding:5px 8px;border-radius:6px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-primary,#1f2329)}
.gitp-logrow:hover{background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.gitp-logrow .hash{font-family:Consolas,Menlo,monospace;color:var(--dsw-alias-brand-primary,#3370ff)}
.gitp-logrow .subj{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gitp-logrow .meta{color:var(--dsw-alias-label-secondary,#646a73);font-size:11px;white-space:nowrap}
.gitp-brow{display:flex;gap:8px;align-items:center;padding:5px 8px;border-radius:6px;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329)}
.gitp-brow .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gitp-brow .cur{color:var(--dsw-alias-brand-primary,#3370ff);font-weight:600}
.gitp-brow .mini{border:1px solid var(--dsw-alias-border-l2,#d0d3d9);background:none;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary,#646a73)}
.gitp-err{color:var(--dsw-alias-state-error-primary,#f53f3f);font-size:12px;line-height:1.6;padding:6px 8px;background:var(--dsw-alias-state-error-1,#ffece8);border-radius:6px;white-space:pre-wrap;word-break:break-all}
.gitp-overlay-mask{position:fixed;inset:0;z-index:1199;background:rgba(0,0,0,.25)}
.gitp-modal{position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:1300;width:min(440px,calc(100vw - 48px));background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,#d0d3d9);border-radius:10px;padding:16px 18px;box-shadow:0 8px 32px rgba(0,0,0,.18);pointer-events:auto}
.gitp-modal .t{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329);margin:0 0 8px}
.gitp-modal .d{font-size:12px;color:var(--dsw-alias-label-secondary,#646a73);line-height:1.7;margin:0 0 14px;word-break:break-all}
.gitp-modal .row{display:flex;justify-content:flex-end;gap:8px}
.gitp-input-btn{border:1px solid var(--dsw-alias-border-l2,#d0d3d9);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#646a73);border-radius:6px;padding:3px 9px;font-size:13px;cursor:pointer}
.gitp-input-btn:hover{border-color:var(--dsw-alias-brand-primary,#3370ff);color:var(--dsw-alias-brand-primary,#3370ff)}
.gitp-sidebar-btn{border:none;background:none;color:var(--dsw-alias-label-secondary,#646a73);font-size:13px;cursor:pointer;padding:6px 8px;border-radius:6px}
.gitp-sidebar-btn:hover{color:var(--dsw-alias-brand-primary,#3370ff);background:var(--dsw-alias-bg-layer-2,#f7f8fa)}
.gitp-empty{padding:18px 0;text-align:center;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}
.gitp-rowline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
`)

    const e = React.createElement

    // ---------- 共享开关（侧边栏 / 输入框 / 面板） ----------
    const openListeners = new Set()
    let open = false
    function setOpen(v) { open = v; for (const l of openListeners) l() }
    function subscribeOpen(fn) { openListeners.add(fn); return function () { openListeners.delete(fn) } }
    function getOpen() { return open }

    const useExternal = (React.useSyncExternalStore !== undefined)
      ? React.useSyncExternalStore
      : function (subscribe, getSnapshot) {
          const [tick, setTick] = React.useState(0)
          React.useEffect(function () { return subscribe(function () { setTick(function (t) { return t + 1 }) }) }, [])
          return getSnapshot()
        }

    function call(method, args) {
      return host.call(method, args)
    }

    // ---------- 面板 ----------
    function GitPanel(props) {
      const visible = useExternal(subscribeOpen, getOpen)
      const [repoPath, setRepoPath] = React.useState('')
      const [tab, setTab] = React.useState('changes')
      const [data, setData] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [diff, setDiff] = React.useState('')
      const [diffLabel, setDiffLabel] = React.useState('')
      const [diffLoading, setDiffLoading] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [generating, setGenerating] = React.useState(false)
      const [confirm, setConfirm] = React.useState(null)
      const [newBranch, setNewBranch] = React.useState('')

      const sessionCwd = props.useSessions(function (s) {
        const cur = s && s.current ? s.byId[s.current] : undefined
        return cur ? cur.cwd : undefined
      })

      React.useEffect(function () {
        if (!repoPath && sessionCwd) setRepoPath(sessionCwd)
      }, [sessionCwd])

      React.useEffect(function () {
        if (visible && repoPath && !data) refresh()
      }, [visible, repoPath])

      if (!visible) return null

      function refresh() {
        if (!repoPath.trim()) { setError('请填写仓库目录（默认取当前会话工作目录）'); return }
        setLoading(true); setError('')
        call('git.panelState', { repoPath: repoPath.trim() }).then(function (res) {
          setLoading(false)
          if (res && res.ok) { setData(res); setDiff('') }
          else setError((res && res.error) || '读取失败')
        }).catch(function (err) { setLoading(false); setError(String((err && err.message) || err)) })
      }

      function run(method, args, after) {
        if (!repoPath.trim()) { setError('请填写仓库目录'); return Promise.resolve(null) }
        setBusy(true); setError('')
        return call(method, Object.assign({ repoPath: repoPath.trim() }, args)).then(function (res) {
          setBusy(false)
          if (res && res.ok) { if (after) after(res); refresh() }
          else setError((res && res.error) || '操作失败')
          return res
        }).catch(function (err) { setBusy(false); setError(String((err && err.message) || err)); return null })
      }

      function viewDiff(path, staged) {
        if (!repoPath.trim()) return
        setDiffLabel((staged ? '已暂存 ' : '工作区 ') + path)
        setDiffLoading(true); setError('')
        call('git.diff', { repoPath: repoPath.trim(), staged: staged === true, path: path }).then(function (res) {
          setDiffLoading(false)
          if (res && res.ok) setDiff(res.text)
          else setDiff('')
        }).catch(function (err) { setDiffLoading(false); setError(String((err && err.message) || err)) })
      }

      function viewCommit(commit) {
        if (!repoPath.trim()) return
        setDiffLabel('提交 ' + commit)
        setDiffLoading(true); setError('')
        call('git.show', { repoPath: repoPath.trim(), commit: commit }).then(function (res) {
          setDiffLoading(false)
          if (res && res.ok) setDiff(res.text)
          else setDiff('')
        }).catch(function (err) { setDiffLoading(false); setError(String((err && err.message) || err)) })
      }

      const s = data ? data.status : null

      function FileRow(f) {
        const p = f.path
        const mini = f.staged
          ? e('button', { className: 'mini', onClick: function (ev) { ev.stopPropagation(); run('git.unstage', { paths: [p] }) }, disabled: busy }, '取消暂存')
          : e('button', { className: 'mini', onClick: function (ev) { ev.stopPropagation(); run('git.stage', { paths: [p] }) }, disabled: busy }, '暂存')
        return e('div', { className: 'gitp-file' + (f.conflict ? ' conflict' : ''), key: p, onClick: function () { viewDiff(p, f.staged) } },
          e('span', { className: 'name' }, (f.conflict ? '⚠ ' : '') + p),
          mini,
        )
      }

      const stagedFiles = (s ? s.staged : []).map(function (x) { return { path: x.path, staged: true, conflict: false } })
      const unstagedFiles = (s ? s.unstaged : []).map(function (x) { return { path: x.path, staged: false, conflict: false } })
      const untrackedFiles = (s ? s.untracked : []).map(function (x) { return { path: x.path, staged: false, conflict: false } })
      const conflictFiles = (s ? s.conflicts : []).map(function (x) { return { path: x.path, staged: false, conflict: true } })
      const allStaged = (s ? s.staged : []).map(function (x) { return x.path })
      const allUnstaged = unstagedFiles.concat(untrackedFiles).map(function (x) { return x.path })

      function changesTab() {
        if (!s) {
          if (loading) return e('div', { className: 'gitp-empty' }, '加载中…')
          if (data && data.notARepo) {
            return e('div', null,
              e('div', { className: 'gitp-err', style: { marginBottom: 8 } }, '⚠ ' + data.notARepo),
              e('div', { className: 'gitp-empty' }, '请在顶部填写 git 仓库目录后点「刷新」'),
            )
          }
          return e('div', { className: 'gitp-empty' }, '点击「刷新」读取仓库状态')
        }
        if (s.clean && !conflictFiles.length) return e('div', { className: 'gitp-empty' }, '工作区干净 ✓')
        return e('div', null,
          conflictFiles.length ? e('div', null,
            e('div', { className: 'gitp-group' }, '冲突 (' + conflictFiles.length + ')'),
            conflictFiles.map(FileRow),
          ) : null,
          e('div', null,
            e('div', { className: 'gitp-group' }, '已暂存 (' + stagedFiles.length + ')'),
            stagedFiles.length ? e('div', { className: 'gitp-rowline' },
              e('button', { className: 'gitp-btn', onClick: function () { run('git.unstage', { paths: allStaged }) }, disabled: busy || !allStaged.length }, '全部取消暂存'),
            ) : null,
            stagedFiles.map(FileRow),
          ),
          e('div', null,
            e('div', { className: 'gitp-group' }, '未暂存 (' + unstagedFiles.length + ')'),
            unstagedFiles.map(FileRow),
          ),
          e('div', null,
            e('div', { className: 'gitp-group' }, '未跟踪 (' + untrackedFiles.length + ')'),
            untrackedFiles.length ? e('div', { className: 'gitp-rowline' },
              e('button', { className: 'gitp-btn', onClick: function () { run('git.stage', { paths: allUnstaged }) }, disabled: busy || !allUnstaged.length }, '全部暂存'),
            ) : null,
            untrackedFiles.map(FileRow),
          ),
          diffLabel ? e('div', null,
            e('div', { className: 'gitp-group' }, diffLabel),
            diffLoading ? e('div', { className: 'gitp-empty' }, '加载 diff…') : e('pre', { className: 'gitp-diff' }, diff || '(无内容)'),
          ) : null,
        )
      }

      function commitTab() {
        return e('div', null,
          e('textarea', { className: 'gitp-msg', placeholder: '提交信息（第一行为主题）', value: message, onChange: function (ev) { setMessage(ev.target.value) } }),
          e('div', { className: 'gitp-rowline', style: { marginTop: 8 } },
            e('button', { className: 'gitp-btn', onClick: function () {
              setGenerating(true); setError('')
              call('git.commitMessage', { repoPath: repoPath.trim() }).then(function (res) {
                setGenerating(false)
                if (res && res.ok) setMessage(res.message)
                else setError((res && res.error) || '生成失败')
              }).catch(function (err) { setGenerating(false); setError(String((err && err.message) || err)) })
            }, disabled: generating || busy }, generating ? '生成中…' : 'AI 生成提交信息'),
            e('button', { className: 'gitp-btn primary', onClick: function () {
              if (!message.trim()) { setError('提交信息不能为空'); return }
              run('git.commit', { message: message.trim() }, function () { setMessage('') })
            }, disabled: busy || !message.trim() }, '提交'),
          ),
          e('div', { className: 'gitp-hint', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#646a73)', marginTop: 6 } }, 'AI 生成基于暂存区 diff，使用 Conventional Commits 格式（默认 tokenrhythm/qwen3.8-max，可在 ~/.dsh/dsh-git.json 配置 commitModel）。'),
        )
      }

      function historyTab() {
        const rows = (data && data.log ? data.log.split('\n') : []).filter(function (l) { return l.trim() })
        if (!rows.length) return e('div', { className: 'gitp-empty' }, '（无提交记录）')
        return e('div', null, rows.map(function (line) {
          const p = line.split('|')
          return e('div', { className: 'gitp-logrow', key: line, onClick: function () { viewCommit(p[0]) } },
            e('span', { className: 'hash' }, p[0] || ''),
            e('span', { className: 'subj' }, p[3] || ''),
            e('span', { className: 'meta' }, (p[1] || '') + ' · ' + (p[2] || '')),
          )
        }))
      }

      function branchTab() {
        const branches = (data && data.branches) || []
        return e('div', null,
          e('div', { className: 'gitp-rowline' },
            e('input', { className: 'gitp-repo', style: { flex: 1 }, placeholder: '新分支名', value: newBranch, onChange: function (ev) { setNewBranch(ev.target.value) } }),
            e('button', { className: 'gitp-btn primary', onClick: function () {
              if (!newBranch.trim()) { setError('分支名不能为空'); return }
              run('git.branch', { action: 'create', name: newBranch.trim() }, function () { setNewBranch('') })
            }, disabled: busy || !newBranch.trim() }, '新建'),
          ),
          e('div', { style: { marginTop: 8 } }, branches.map(function (b) {
            return e('div', { className: 'gitp-brow', key: b.name },
              e('span', { className: 'name' + (b.current ? ' cur' : ''), onClick: function () {
                if (!b.current) run('git.checkout', { target: b.name })
              }, style: b.current ? {} : { cursor: 'pointer' } }, (b.current ? '● ' : '') + b.name + (b.upstream ? ' → ' + b.upstream : '')),
              b.current ? null : e('button', { className: 'mini', onClick: function () {
                setConfirm({ title: '删除分支', desc: '删除分支 ' + b.name + '？', action: function () { return run('git.branch', { action: 'delete', name: b.name, confirm: true }) } })
              }, disabled: busy }, '删除'),
            )
          })),
        )
      }

      function moreTab() {
        return e('div', null,
          e('div', { className: 'gitp-group' }, '同步'),
          e('div', { className: 'gitp-rowline' },
            e('button', { className: 'gitp-btn', onClick: function () { run('git.pull', {}) }, disabled: busy }, '拉取 pull'),
            e('button', { className: 'gitp-btn', onClick: function () { run('git.push', {}) }, disabled: busy }, '推送 push'),
            e('button', { className: 'gitp-btn danger', onClick: function () {
              setConfirm({ title: '强制推送', desc: 'git push --force 会覆盖远端历史，确定？', action: function () { return run('git.push', { force: true, confirm: true }) } })
            }, disabled: busy }, '强制推送'),
          ),
          e('div', { className: 'gitp-group' }, '回滚'),
          e('div', { className: 'gitp-rowline' },
            e('button', { className: 'gitp-btn', onClick: function () { run('git.reset', { mode: 'soft' }) }, disabled: busy }, 'reset --soft'),
            e('button', { className: 'gitp-btn', onClick: function () { run('git.reset', { mode: 'mixed' }) }, disabled: busy }, 'reset --mixed'),
            e('button', { className: 'gitp-btn danger', onClick: function () {
              setConfirm({ title: '重置 (hard)', desc: 'git reset --hard 会丢弃所有未提交改动（不可恢复），确定？', action: function () { return run('git.reset', { mode: 'hard', confirm: true }) } })
            }, disabled: busy }, 'reset --hard'),
          ),
          e('div', { className: 'gitp-group' }, '清理'),
          e('div', { className: 'gitp-rowline' },
            e('button', { className: 'gitp-btn', onClick: function () { run('git.clean', { dryRun: true }) }, disabled: busy }, 'clean 预览'),
            e('button', { className: 'gitp-btn danger', onClick: function () {
              setConfirm({ title: '清理未跟踪文件', desc: 'git clean -fd 会删除所有未跟踪文件（不可恢复），确定？', action: function () { return run('git.clean', { dryRun: false, confirm: true }) } })
            }, disabled: busy }, 'clean 执行'),
          ),
          e('div', { className: 'gitp-group' }, 'stash'),
          e('div', { className: 'gitp-rowline' },
            e('button', { className: 'gitp-btn', onClick: function () { run('git.stash', { action: 'push', message: 'dsh-git 面板' }) }, disabled: busy }, 'stash push'),
            e('button', { className: 'gitp-btn', onClick: function () { run('git.stash', { action: 'pop' }) }, disabled: busy }, 'stash pop'),
            e('button', { className: 'gitp-btn', onClick: function () { run('git.stash', { action: 'list' }) }, disabled: busy }, 'stash list'),
          ),
        )
      }

      const tabs = [
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

      const confirmModal = confirm ? e('div', { className: 'gitp-overlay-mask', onClick: function (ev) { if (ev.target === ev.currentTarget) setConfirm(null) } },
        e('div', { className: 'gitp-modal', onClick: function (ev) { ev.stopPropagation() } },
          e('p', { className: 't' }, confirm.title),
          e('p', { className: 'd' }, confirm.desc),
          e('div', { className: 'row' },
            e('button', { className: 'gitp-btn', onClick: function () { setConfirm(null) }, disabled: busy }, '取消'),
            e('button', { className: 'gitp-btn danger', onClick: function () {
              const act = confirm.action
              setConfirm(null)
              if (act) act()
            }, disabled: busy }, '确认'),
          ),
        ),
      ) : null

      return e('div', { className: 'gitp-panel' },
        e('div', { className: 'gitp-head' },
          e('h3', { className: 'gitp-title' }, 'Git 面板'),
          e('input', { className: 'gitp-repo', placeholder: '仓库目录（默认当前会话工作目录）', value: repoPath, onChange: function (ev) { setRepoPath(ev.target.value) } }),
          e('button', { className: 'gitp-btn', onClick: refresh, disabled: loading }, loading ? '…' : '刷新'),
          e('button', { className: 'gitp-btn', onClick: function () { setOpen(false) } }, '✕'),
        ),
        s ? e('div', { className: 'gitp-status' },
          e('span', { className: 'gitp-branch' }, s.head || '(无分支)'),
          s.upstream ? e('span', null, '↑' + s.ahead + ' ↓' + s.behind) : null,
          e('span', null, '冲突 ' + s.conflicts.length),
          e('span', null, '已暂存 ' + s.staged.length),
          e('span', null, '未暂存 ' + s.unstaged.length),
          e('span', null, '未跟踪 ' + s.untracked.length),
        ) : null,
        e('div', { className: 'gitp-tabs' }, tabs.map(function (t) {
          return e('button', { key: t.id, className: 'gitp-tab' + (tab === t.id ? ' active' : ''), onClick: function () { setTab(t.id) } }, t.label)
        })),
        e('div', { className: 'gitp-body' },
          error ? e('div', { className: 'gitp-err' }, error) : null,
          body,
        ),
        confirmModal,
      )
    }

    // ---------- 入口注册 ----------
    slots.inject('sidebar.footer.action', function () {
      return slots.register(
        { name: 'sidebar.footer.action', id: 'git-panel', order: 20 },
        function (props) {
          return e('button', { className: 'gitp-sidebar-btn', title: 'Git 面板', onClick: function () { setOpen(!getOpen()) } },
            props.wide ? 'Git' : '⑂')
        },
      )
    })

    slots.inject('conversation.input.left', function () {
      return slots.register(
        { name: 'conversation.input.left', id: 'git-panel-input', order: 20 },
        function () {
          return e('button', { className: 'gitp-input-btn', title: 'Git 面板', onClick: function () { setOpen(!getOpen()) } }, '⑂ Git')
        },
      )
    })

    slots.inject('shell.overlay', function () {
      return slots.register(
        { name: 'shell.overlay', id: 'git-panel-overlay', order: 20 },
        GitPanel,
      )
    })
  },
}
