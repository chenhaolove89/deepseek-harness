return {
  apply(ctx) {
    // ---------- git 执行器：argv 直调，跨平台、无 shell 注入 ----------
    async function execGit(args, exec) {
      const subprocess = ctx.get('subprocess')
      if (subprocess === undefined) throw new Error('subprocess 服务不可用')
      let git = 'git'
      try { git = await subprocess.resolveExecutable('git') } catch (e) { /* PATH 兜底 */ }
      const handle = subprocess.spawn({
        argv: [git].concat(args),
        cwd: '',
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 16 * 1024 * 1024 },
          stderr: { maxBytes: 512 * 1024 },
        },
        graceMs: 20000,
        signal: exec && exec.signal ? exec.signal : undefined,
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
      const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
      return { exitCode: outcome.exitCode, stdout: stdout, stderr: stderr }
    }

    // ---------- 会话工作目录与仓库根解析 ----------
    function sessionCwd(exec) {
      const header = exec && exec.agent && exec.agent.session && exec.agent.session.header
      return header && header.cwd ? header.cwd : undefined
    }

    async function repoRootOf(exec, repoPath) {
      const start = (typeof repoPath === 'string' && repoPath.trim()) ? repoPath.trim() : sessionCwd(exec)
      if (!start) throw new Error('无法确定仓库目录：请传 repoPath 或确认会话工作目录')
      const r = await execGit(['-C', start, 'rev-parse', '--show-toplevel'], exec)
      if (r.exitCode !== 0) {
        throw new Error('不是 git 仓库（或 git 不可用）: ' + start + ' — ' + (r.stderr || r.stdout).slice(0, 300))
      }
      return r.stdout.trim()
    }

    // ---------- porcelain v2 解析（git_status） ----------
    function statusLetter(x) {
      return { M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', U: '冲突', '?': '未跟踪' }[x] || x
    }

    function parseStatus(text) {
      const out = { head: '', upstream: '', ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], conflicts: [] }
      const lines = text.split('\n')
      for (const line of lines) {
        if (line.startsWith('# branch.head ')) out.head = line.slice('# branch.head '.length).trim()
        else if (line.startsWith('# branch.upstream ')) out.upstream = line.slice('# branch.upstream '.length).trim()
        else if (line.startsWith('# branch.ab +')) {
          const m = line.match(/\+(\d+) -(\d+)/)
          if (m) { out.ahead = Number(m[1]); out.behind = Number(m[2]) }
        }
        else if (line.startsWith('? ')) {
          out.untracked.push({ path: line.slice(2) })
        }
        else if (line.startsWith('u ')) {
          const parts = line.split(' ')
          out.conflicts.push({ xy: parts[1], path: parts.slice(9).join(' ') })
        }
        else if (line.startsWith('1 ')) {
          const parts = line.split(' ')
          const xy = parts[1]
          const path = parts.slice(8).join(' ')
          const x = xy[0], y = xy[1]
          const entry = { xy: xy, path: path, x: x, y: y }
          if (x !== '.' && x !== '?') out.staged.push(entry)
          if (y !== '.' && x !== '?') out.unstaged.push(entry)
        }
        else if (line.startsWith('2 ')) {
          // 重命名/复制：path 与 origPath 之间以 \t 分隔
          const parts = line.split(' ')
          const xy = parts[1]
          const x = xy[0], y = xy[1]
          const rest = parts.slice(9).join(' ')
          const sep = rest.indexOf('\t')
          const path = sep >= 0 ? rest.slice(0, sep) : rest
          const orig = sep >= 0 ? rest.slice(sep + 1) : ''
          const entry = { xy: xy, path: path, x: x, y: y, orig: orig }
          if (x !== '.' && x !== '?') out.staged.push(entry)
          if (y !== '.' && x !== '?') out.unstaged.push(entry)
        }
      }
      return out
    }

    function formatStatus(s, root) {
      const lines = []
      lines.push('仓库: ' + root)
      const branchLine = s.head ? '分支: ' + s.head : '分支: (无 HEAD / 未提交)'
      lines.push(branchLine + (s.upstream ? '（上游: ' + s.upstream + '）' : ''))
      if (s.ahead || s.behind) lines.push('同步状态: ahead ' + s.ahead + ' / behind ' + s.behind)
      if (s.conflicts.length) {
        lines.push('冲突 (' + s.conflicts.length + '):')
        for (const c of s.conflicts) lines.push('  ' + statusLetter(c.xy[1] || 'U') + '  ' + c.path)
      }
      if (s.staged.length) {
        lines.push('已暂存 (' + s.staged.length + '):')
        for (const e of s.staged) lines.push('  ' + statusLetter(e.x) + (e.orig ? '  ' + e.path + ' ← ' + e.orig : '  ' + e.path))
      }
      if (s.unstaged.length) {
        lines.push('未暂存 (' + s.unstaged.length + '):')
        for (const e of s.unstaged) lines.push('  ' + statusLetter(e.y) + (e.orig ? '  ' + e.path + ' ← ' + e.orig : '  ' + e.path))
      }
      if (s.untracked.length) {
        lines.push('未跟踪 (' + s.untracked.length + '):')
        for (const u of s.untracked) lines.push('  ?  ' + u.path)
      }
      if (s.staged.length + s.unstaged.length + s.untracked.length + s.conflicts.length === 0) {
        lines.push('工作区干净')
      }
      return lines.join('\n')
    }

    const registerTool = function (definition) {
      return harness.registerTool(ctx, harness.defineTool(definition))
    }

    // ---------- git_status ----------
    registerTool({
      name: 'git_status',
      description: '查看 git 仓库状态：当前分支、ahead/behind 同步状态、变更文件（按已暂存/未暂存/未跟踪/冲突分组）。repoPath 可指定仓库目录（默认当前会话工作目录，自动向上查找仓库根）。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      },
      output: { schema: { type: 'string' }, render: function (_a, v) { return [{ type: 'text', text: String(v) }] } },
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const r = await execGit(['-C', root, 'status', '--porcelain=v2', '-b'], exec)
        if (r.exitCode !== 0) throw new Error('git status 失败: ' + (r.stderr || r.stdout).slice(0, 300))
        return formatStatus(parseStatus(r.stdout), root)
      },
    })

    // ---------- git_diff ----------
    registerTool({
      name: 'git_diff',
      description: '查看未提交变更的 diff。staged=true 查看已暂存区（--cached），staged=false 查看工作区相对 HEAD 的全部变更（含暂存）；stat=true 只输出文件统计（numstat）；path 可限定单个文件。大 diff 会被截断并给出提示。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        staged: { type: 'boolean', description: '是否查看暂存区（默认 false）' },
        stat: { type: 'boolean', description: '只输出统计（默认 false）' },
        path: { type: 'string', description: '限定文件路径（可选）' },
      },
      output: { schema: { type: 'string' }, render: function (_a, v) { return [{ type: 'text', text: String(v) }] } },
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const head = args.staged ? ['--cached'] : ['HEAD']
        const tail = (typeof args.path === 'string' && args.path.trim()) ? ['--', args.path.trim()] : []
        if (args.stat) {
          const r = await execGit(['-C', root, 'diff'].concat(head, ['--numstat'], tail), exec)
          if (r.exitCode !== 0) throw new Error('git diff 失败: ' + (r.stderr || r.stdout).slice(0, 300))
          return r.stdout.trim() ? r.stdout : '(无变更)'
        }
        const r = await execGit(['-C', root, 'diff'].concat(head, tail), exec)
        if (r.exitCode !== 0) throw new Error('git diff 失败: ' + (r.stderr || r.stdout).slice(0, 300))
        if (!r.stdout.trim()) return '(无变更)'
        const MAX = 200000
        const body = r.stdout.slice(0, MAX)
        return body + (r.stdout.length > MAX ? '\n\n[输出已截断（' + r.stdout.length + ' 字节），建议用 stat=true 或 path 缩小范围]' : '')
      },
    })

    // ---------- git_log ----------
    registerTool({
      name: 'git_log',
      description: '查看提交历史，每行格式：短哈希|作者|日期|主题，最多 n 条（默认 20，上限 100）。path 可限定单个文件的历史。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        n: { type: 'integer', description: '条数（默认 20，上限 100）' },
        path: { type: 'string', description: '限定文件路径（可选）' },
      },
      output: { schema: { type: 'string' }, render: function (_a, v) { return [{ type: 'text', text: String(v) }] } },
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const n = Math.min(Math.max(1, Number(args.n) || 20), 100)
        const tail = (typeof args.path === 'string' && args.path.trim()) ? ['--', args.path.trim()] : []
        const r = await execGit(['-C', root, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', String(n)].concat(tail), exec)
        if (r.exitCode !== 0) throw new Error('git log 失败: ' + (r.stderr || r.stdout).slice(0, 300))
        return r.stdout.trim() ? r.stdout : '(无提交记录)'
      },
    })
  },
}
