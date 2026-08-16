return {
  apply(ctx) {
    // ================= 基础：git 执行器（argv 直调，无 shell 注入） =================
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
          stdout: { maxBytes: 32 * 1024 * 1024 },
          stderr: { maxBytes: 1024 * 1024 },
        },
        graceMs: 30000,
        signal: exec && exec.signal ? exec.signal : undefined,
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
      const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
      return { exitCode: outcome.exitCode, stdout: stdout, stderr: stderr }
    }

    async function execGitOk(args, exec, label) {
      const r = await execGit(args, exec)
      if (r.exitCode !== 0) {
        throw new Error(label + ' 失败: ' + (r.stderr || r.stdout || '未知错误').slice(0, 500))
      }
      return r
    }

    // ================= 仓库根解析 =================
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

    // ================= 配置（~/.dsh/dsh-git.json） =================
    const CFG_READER = `const os=require('node:os'),path=require('node:path'),fs=require('node:fs');
const f=path.join(os.homedir(),'.dsh','dsh-git.json');
try{const s=fs.readFileSync(f,'utf8');process.stdout.write(JSON.stringify({ok:true,data:JSON.parse(s)}));}
catch(e){process.stdout.write(JSON.stringify({ok:false,error:String((e&&e.message)||e)}));}`

    const CONFIG_DEFAULTS = {
      commitModel: { provider: 'tokenrhythm', model: 'qwen3.8-max' },
      autoRefreshMs: 5000,
    }

    let configCache = null

    async function readConfig() {
      if (configCache !== null) return configCache
      const defaults = JSON.parse(JSON.stringify(CONFIG_DEFAULTS))
      try {
        const subprocess = ctx.get('subprocess')
        if (subprocess === undefined) return defaults
        let node = 'node'
        try { node = await subprocess.resolveExecutable('node') } catch (e) { /* PATH 兜底 */ }
        const handle = subprocess.spawn({
          argv: [node, '-e', CFG_READER],
          cwd: '',
          stdio: { stdin: 'ignore', stdout: { maxBytes: 256 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
          graceMs: 5000,
        })
        const outcome = await handle.done
        const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
        let parsed = null
        try { parsed = JSON.parse(stdout || '{}') } catch (e) { /* 非 JSON 视为损坏 */ }
        if (outcome.exitCode === 0 && parsed && parsed.ok && parsed.data && typeof parsed.data === 'object') {
          const data = parsed.data
          const merged = JSON.parse(JSON.stringify(defaults))
          if (typeof data.commitModel === 'object' && data.commitModel !== null) {
            if (typeof data.commitModel.provider === 'string' && data.commitModel.provider) merged.commitModel.provider = data.commitModel.provider
            if (typeof data.commitModel.model === 'string' && data.commitModel.model) merged.commitModel.model = data.commitModel.model
          }
          if (typeof data.autoRefreshMs === 'number' && data.autoRefreshMs >= 1000) merged.autoRefreshMs = data.autoRefreshMs
          configCache = merged
          return merged
        }
      } catch (e) { /* 配置读取失败则用默认 */ }
      configCache = defaults
      return defaults
    }

    // ================= 危险操作审批门 =================
    // 危险操作必须同时满足：模型显式 confirm: true + 会话审批（ask 时弹窗、never 时拒绝）。
    async function gateDanger(exec, toolName, reason) {
      const approval = ctx.get('approval')
      if (approval === undefined) return
      const agent = exec && exec.agent
      if (agent === undefined) return
      const outcome = await approval.request({ agent: agent, toolName: toolName, reason: reason })
      if (outcome !== 'allowed-once') {
        throw new Error('危险操作未获批准（' + outcome + '）：' + reason)
      }
    }

    function requireConfirm(exec, args, toolName, reason) {
      if (!(args && args.confirm === true)) {
        throw new Error('危险操作需要显式确认：请设置 confirm: true（并在征得用户同意后执行）—— ' + reason)
      }
      return gateDanger(exec, toolName, reason)
    }

    function pathList(args, key) {
      const raw = args && args[key]
      const list = Array.isArray(raw) ? raw.map(function (p) { return String(p) }) : []
      if (list.length === 0) throw new Error('缺少 ' + key + ' 参数（非空字符串数组）')
      return list
    }

    function cap(text, max, note) {
      if (text.length <= max) return text
      return text.slice(0, max) + '\n\n[输出已截断（' + text.length + ' 字节），' + note + ']'
    }

    // ================= status 解析（porcelain v2） =================
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
          out.untracked.push({ xy: '??', path: line.slice(2) })
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

    async function statusObject(exec, repoPath) {
      const root = await repoRootOf(exec, repoPath)
      const r = await execGit(['-C', root, 'status', '--porcelain=v2', '-b'], exec)
      if (r.exitCode !== 0) throw new Error('git status 失败: ' + (r.stderr || r.stdout).slice(0, 300))
      const s = parseStatus(r.stdout)
      s.root = root
      s.clean = s.staged.length + s.unstaged.length + s.untracked.length + s.conflicts.length === 0
      return s
    }

    // ================= 提交信息 AI 生成 =================
    function commitPrompt(diffText, history) {
      return '你是资深工程师。请根据下面的 git 变更生成一条 Conventional Commits 格式的提交信息。\n'
        + '要求：\n'
        + '1. 第一行格式: type(scope): subject（type ∈ feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert，scope 可选，subject 用祈使句、不超过 72 字符）\n'
        + '2. 如变更较复杂，空一行后附简短正文（bullet 列表说明要点），最多 5 行\n'
        + '3. 语言与仓库近期提交风格保持一致\n'
        + '4. 只输出提交信息本身，不要任何解释、引号或 markdown 代码块\n\n'
        + '仓库近期提交风格参考：\n' + (history || '（无历史）') + '\n\n'
        + '变更内容（git diff --cached）：\n' + (diffText || '（暂存区为空）')
    }

    async function generateCommitMessage(exec, repoPath, signal) {
      const llm = ctx.get('llm')
      if (llm === undefined) throw new Error('llm 服务不可用（提交信息生成需要）')
      const cfg = await readConfig()
      const route = cfg.commitModel
      let found = false
      try {
        const models = await llm.listModels(route.provider)
        found = Array.isArray(models) && models.some(function (m) { return m && m.id === route.model })
      } catch (e) { found = false }
      if (!found) {
        throw new Error('提交信息生成路由不可用: ' + route.provider + '/' + route.model
          + '（请在 ~/.dsh/dsh-git.json 配置 commitModel.provider/model，或先导入该供应商）')
      }
      const diffR = await execGit(['-C', repoPath, 'diff', '--cached'], exec)
      if (diffR.exitCode !== 0) throw new Error('读取暂存区失败: ' + (diffR.stderr || diffR.stdout).slice(0, 300))
      const logR = await execGit(['-C', repoPath, 'log', '--pretty=format:%s', '-n', '15'], exec)
      const diffText = diffR.stdout.slice(0, 60000)
      const history = logR.stdout.trim()
      const prompt = commitPrompt(diffText, history)
      const message = {
        id: 'gitmsg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      }
      let out = ''
      let finish = null
      for await (const chunk of llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [message],
        signal: signal,
        maxTokens: 2048,
      })) {
        if (chunk.type === 'text-delta') out += chunk.text
        else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') out += chunk.block.text
        else if (chunk.type === 'finish') finish = chunk
      }
      if (finish && finish.reason && finish.reason.kind === 'error') {
        const f = finish.reason.failure
        throw new Error('模型调用失败: ' + String((f && (f.message || f.code)) || '未知错误'))
      }
      const msg = out.trim()
      if (!msg) throw new Error('模型未生成提交信息（返回为空）')
      return msg
    }

    // ================= 工具注册 =================
    const registerTool = function (definition) {
      return harness.registerTool(ctx, harness.defineTool(definition))
    }

    const TEXT_OUTPUT = {
      schema: { type: 'string' },
      render: function (_a, v) { return [{ type: 'text', text: String(v) }] },
    }

    // ---------- 只读：git_status ----------
    registerTool({
      name: 'git_status',
      description: '查看 git 仓库状态：当前分支、ahead/behind 同步状态、变更文件（按已暂存/未暂存/未跟踪/冲突分组）。repoPath 可指定仓库目录（默认当前会话工作目录，自动向上查找仓库根）。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const s = await statusObject(exec, args.repoPath)
        return formatStatus(s, s.root)
      },
    })

    // ---------- 只读：git_diff ----------
    registerTool({
      name: 'git_diff',
      description: '查看未提交变更的 diff。staged=true 查看已暂存区（--cached），staged=false 查看工作区相对 HEAD 的全部变更（含暂存）；stat=true 只输出文件统计（numstat）；path 可限定单个文件。大 diff 会被截断并给出提示。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        staged: { type: 'boolean', description: '是否查看暂存区（默认 false）' },
        stat: { type: 'boolean', description: '只输出统计（默认 false）' },
        path: { type: 'string', description: '限定文件路径（可选）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const head = args.staged ? ['--cached'] : ['HEAD']
        const tail = (typeof args.path === 'string' && args.path.trim()) ? ['--', args.path.trim()] : []
        if (args.stat) {
          const r = await execGitOk(['-C', root, 'diff'].concat(head, ['--numstat'], tail), exec, 'git diff')
          return r.stdout.trim() ? r.stdout : '(无变更)'
        }
        const r = await execGitOk(['-C', root, 'diff'].concat(head, tail), exec, 'git diff')
        if (!r.stdout.trim()) return '(无变更)'
        return cap(r.stdout, 200000, '建议用 stat=true 或 path 缩小范围')
      },
    })

    // ---------- 只读：git_log ----------
    registerTool({
      name: 'git_log',
      description: '查看提交历史，每行格式：短哈希|作者|日期|主题，最多 n 条（默认 20，上限 100）。path 可限定单个文件的历史。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        n: { type: 'integer', description: '条数（默认 20，上限 100）' },
        path: { type: 'string', description: '限定文件路径（可选）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const n = Math.min(Math.max(1, Number(args.n) || 20), 100)
        const tail = (typeof args.path === 'string' && args.path.trim()) ? ['--', args.path.trim()] : []
        const r = await execGitOk(['-C', root, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', String(n)].concat(tail), exec, 'git log')
        return r.stdout.trim() ? r.stdout : '(无提交记录)'
      },
    })

    // ---------- 只读：git_show ----------
    registerTool({
      name: 'git_show',
      description: '查看某次提交的内容（diff）。commit 为提交引用（默认 HEAD）；stat=true 只出统计；path 限定文件。大输出会被截断。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        commit: { type: 'string', description: '提交引用（默认 HEAD）' },
        stat: { type: 'boolean', description: '只输出统计（默认 false）' },
        path: { type: 'string', description: '限定文件路径（可选）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const commit = (typeof args.commit === 'string' && args.commit.trim()) ? args.commit.trim() : 'HEAD'
        const tail = (typeof args.path === 'string' && args.path.trim()) ? ['--', args.path.trim()] : []
        const r = await execGitOk(['-C', root, 'show'].concat(args.stat ? ['--stat'] : [], ['--format=medium', commit], tail), exec, 'git show')
        return cap(r.stdout, 200000, '建议用 stat=true 或 path 缩小范围')
      },
    })

    // ---------- 只读：git_blame ----------
    registerTool({
      name: 'git_blame',
      description: '查看文件每行代码的提交归属（git blame）。path 必填；line 可指定单行（1-based）。输出格式：短哈希|作者|日期|行内容。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        path: { type: 'string', required: true, description: '文件路径' },
        line: { type: 'integer', description: '只看某一行（1-based，可选）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const path = String(args.path || '').trim()
        if (!path) throw new Error('缺少 path 参数')
        const line = Number(args.line)
        const range = (Number.isInteger(line) && line > 0) ? ['-L', line + ',' + line] : []
        const r = await execGitOk(['-C', root, 'blame', '--date=short', '--pretty=format:%h|%an|%ad'].concat(range, ['--', path]), exec, 'git blame')
        return cap(r.stdout, 200000, '建议用 line 参数缩小范围')
      },
    })

    // ---------- 写：git_stage ----------
    registerTool({
      name: 'git_stage',
      description: '把文件加入暂存区（git add）。paths 为相对仓库根的文件路径数组（可用 "." 表示全部）。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        paths: { type: 'array', items: { type: 'string' }, required: true, description: '要暂存的文件路径数组（"." 表示全部）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const paths = pathList(args, 'paths')
        const r = await execGitOk(['-C', root, 'add', '--'].concat(paths), exec, 'git add')
        const label = paths.length === 1 ? paths[0] : paths.length + ' 个文件'
        return '已暂存 ' + label + (r.stdout.trim() ? '\n' + r.stdout.trim() : '')
      },
    })

    // ---------- 写：git_unstage ----------
    registerTool({
      name: 'git_unstage',
      description: '把文件移出暂存区（git restore --staged，即取消暂存，不改动工作区内容）。paths 为文件路径数组。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        paths: { type: 'array', items: { type: 'string' }, required: true, description: '要取消暂存的文件路径数组' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const paths = pathList(args, 'paths')
        const r = await execGitOk(['-C', root, 'restore', '--staged', '--'].concat(paths), exec, 'git restore --staged')
        const label = paths.length === 1 ? paths[0] : paths.length + ' 个文件'
        return '已取消暂存 ' + label
      },
    })

    // ---------- 写：git_commit ----------
    registerTool({
      name: 'git_commit',
      description: '创建提交（git commit -m）。message 必填（可用 git_commit_message 工具生成）；amend=true 时改写最近一次提交（需谨慎，推送过的提交改写后需 force push）。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        message: { type: 'string', required: true, description: '提交信息（第一行为主题，可含换行正文）' },
        amend: { type: 'boolean', description: '是否改写最近一次提交（默认 false）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const message = String(args.message || '').trim()
        if (!message) throw new Error('缺少 message 参数')
        const argv = ['-C', root, 'commit']
        if (args.amend) argv.push('--amend')
        argv.push('-m', message)
        const r = await execGitOk(argv, exec, 'git commit')
        const summary = await execGitOk(['-C', root, 'log', '-1', '--pretty=format:%h|%s'], exec, 'git log')
        const result = (r.stdout || r.stderr || '').trim()
        return '提交完成: ' + (summary.stdout.trim() || '') + (result ? '\n' + result : '')
      },
    })

    // ---------- 写：git_commit_message（AI 生成） ----------
    registerTool({
      name: 'git_commit_message',
      description: '根据暂存区（staged）的 diff 和仓库提交风格，用 LLM 生成一条 Conventional Commits 提交信息（默认 tokenrhythm/qwen3.8-max，可在 ~/.dsh/dsh-git.json 的 commitModel 覆盖）。返回的信息可直接作为 git_commit 的 message。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      },
      output: TEXT_OUTPUT,
      timeoutMs: 90000,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const msg = await generateCommitMessage(exec, root, exec.signal)
        return msg
      },
    })

    // ---------- 写：git_branch ----------
    registerTool({
      name: 'git_branch',
      description: '分支管理。action=list 列出所有分支（含当前分支标记与上游）；create 新建分支（name 必填，from 可选指定起点）；switch 切换分支（create=true 时不存在则创建）；delete 删除分支（force=true 强制删除未合并分支，属危险操作需确认）。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        action: { type: 'string', description: 'list / create / switch / delete（默认 list）' },
        name: { type: 'string', description: '分支名（create/switch/delete 必填）' },
        from: { type: 'string', description: '新建分支的起点（默认当前 HEAD）' },
        create: { type: 'boolean', description: 'switch 时允许自动创建（默认 false）' },
        force: { type: 'boolean', description: 'delete 时强制删除（-D，危险操作）' },
        confirm: { type: 'boolean', description: '危险操作确认（force 删除时必填 true）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const action = (typeof args.action === 'string' && args.action) ? args.action : 'list'
        if (action === 'list') {
          const r = await execGitOk(['-C', root, 'branch', '--format=%(refname:short)|%(HEAD)|%(upstream:short)'], exec, 'git branch')
          const lines = r.stdout.split('\n').filter(function (l) { return l.trim() })
          const text = lines.map(function (l) {
            const parts = l.split('|')
            const current = parts[1] === '*' ? ' *' : ''
            const upstream = parts[2] ? ' → ' + parts[2] : ''
            return (parts[0] || l) + current + upstream
          }).join('\n')
          return '分支列表:\n' + (text || '（无分支）')
        }
        const name = String(args.name || '').trim()
        if (!name) throw new Error('action=' + action + ' 需要 name 参数')
        if (action === 'create') {
          const argv = ['-C', root, 'branch']
          const from = (typeof args.from === 'string' && args.from.trim()) ? args.from.trim() : null
          if (from) argv.push(name, from)
          else argv.push(name)
          await execGitOk(argv, exec, 'git branch')
          return '已创建分支 ' + name + (from ? '（起点 ' + from + '）' : '')
        }
        if (action === 'switch') {
          const argv = ['-C', root, 'checkout']
          if (args.create) argv.push('-b')
          argv.push(name)
          await execGitOk(argv, exec, 'git checkout')
          return '已切换到分支 ' + name
        }
        if (action === 'delete') {
          if (args.force) {
            await requireConfirm(exec, args, 'git_branch', '强制删除分支 ' + name + '（-D）')
            await execGitOk(['-C', root, 'branch', '-D', name], exec, 'git branch -D')
            return '已强制删除分支 ' + name
          }
          await execGitOk(['-C', root, 'branch', '-d', name], exec, 'git branch -d')
          return '已删除分支 ' + name
        }
        throw new Error('未知 action: ' + action + '（支持 list/create/switch/delete）')
      },
    })

    // ---------- 写：git_checkout ----------
    registerTool({
      name: 'git_checkout',
      description: '切换分支（target 为分支名，create=true 时不存在则创建并切换）；或恢复工作区文件（path 指定文件时执行 git checkout -- path，丢弃该文件的未提交改动）。force=true 强制切换丢弃本地改动（危险操作需确认）。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        target: { type: 'string', description: '目标分支名' },
        create: { type: 'boolean', description: '不存在时创建并切换（默认 false）' },
        path: { type: 'string', description: '恢复的文件路径（指定时忽略 target）' },
        force: { type: 'boolean', description: '强制切换丢弃本地改动（危险操作）' },
        confirm: { type: 'boolean', description: '危险操作确认（force 时必填 true）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const path = (typeof args.path === 'string' && args.path.trim()) ? args.path.trim() : ''
        if (path) {
          await execGitOk(['-C', root, 'checkout', '--', path], exec, 'git checkout --')
          return '已恢复文件 ' + path + '（丢弃其未提交改动）'
        }
        const target = String(args.target || '').trim()
        if (!target) throw new Error('缺少 target 或 path 参数')
        const argv = ['-C', root, 'checkout']
        if (args.create) argv.push('-b')
        if (args.force) {
          await requireConfirm(exec, args, 'git_checkout', '强制切换分支 ' + target + '（丢弃本地改动）')
          argv.push('-f')
        }
        argv.push(target)
        await execGitOk(argv, exec, 'git checkout')
        return '已切换到分支 ' + target
      },
    })

    // ---------- 写：git_reset ----------
    registerTool({
      name: 'git_reset',
      description: '重置提交指针与暂存区。mode=soft 只移动 HEAD 保留改动；mixed（默认）同时取消暂存；hard 丢弃所有未提交改动（危险操作需确认，不可恢复）。target 为重置目标（默认 HEAD）。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        mode: { type: 'string', description: 'soft / mixed / hard（默认 mixed）' },
        target: { type: 'string', description: '重置目标提交（默认 HEAD）' },
        confirm: { type: 'boolean', description: '危险操作确认（mode=hard 时必填 true）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const mode = (typeof args.mode === 'string' && args.mode) ? args.mode : 'mixed'
        const target = (typeof args.target === 'string' && args.target.trim()) ? args.target.trim() : 'HEAD'
        const argv = ['-C', root, 'reset']
        if (mode === 'soft') argv.push('--soft')
        else if (mode === 'mixed') argv.push('--mixed')
        else if (mode === 'hard') {
          await requireConfirm(exec, args, 'git_reset', 'git reset --hard ' + target + '（丢弃所有未提交改动，不可恢复）')
          argv.push('--hard')
        }
        else throw new Error('未知 mode: ' + mode + '（支持 soft/mixed/hard）')
        argv.push(target)
        await execGitOk(argv, exec, 'git reset')
        return '已重置到 ' + target + '（mode=' + mode + '）'
      },
    })

    // ---------- 写：git_revert ----------
    registerTool({
      name: 'git_revert',
      description: '撤销指定提交（生成一个反向提交，git revert --no-edit）。commit 必填。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        commit: { type: 'string', required: true, description: '要撤销的提交引用' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const commit = String(args.commit || '').trim()
        if (!commit) throw new Error('缺少 commit 参数')
        const r = await execGitOk(['-C', root, 'revert', '--no-edit', commit], exec, 'git revert')
        return '已撤销提交 ' + commit + '\n' + (r.stdout || r.stderr || '').trim()
      },
    })

    // ---------- 写：git_stash ----------
    registerTool({
      name: 'git_stash',
      description: '暂存/恢复工作区。action=list 列出（默认）；push 保存（message 可选备注）；pop 恢复最近一条并删除；apply 恢复但不删除；drop 删除指定条目（危险，需确认）；clear 清空全部（危险，需确认）。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        action: { type: 'string', description: 'list / push / pop / apply / drop / clear（默认 list）' },
        message: { type: 'string', description: 'push 时的备注（可选）' },
        confirm: { type: 'boolean', description: '危险操作确认（drop/clear 时必填 true）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const action = (typeof args.action === 'string' && args.action) ? args.action : 'list'
        if (action === 'list') {
          const r = await execGitOk(['-C', root, 'stash', 'list'], exec, 'git stash list')
          return r.stdout.trim() ? 'stash 列表:\n' + r.stdout.trim() : '（无 stash）'
        }
        if (action === 'push') {
          const argv = ['-C', root, 'stash', 'push']
          const msg = (typeof args.message === 'string' && args.message.trim()) ? args.message.trim() : ''
          if (msg) argv.push('-m', msg)
          const r = await execGitOk(argv, exec, 'git stash push')
          return '已暂存工作区' + (msg ? '（' + msg + '）' : '') + '\n' + (r.stdout || r.stderr || '').trim()
        }
        if (action === 'pop' || action === 'apply') {
          const r = await execGitOk(['-C', root, 'stash', action], exec, 'git stash ' + action)
          return '已' + (action === 'pop' ? '恢复并删除' : '应用') + '最新 stash\n' + (r.stdout || r.stderr || '').trim()
        }
        if (action === 'drop' || action === 'clear') {
          await requireConfirm(exec, args, 'git_stash', 'git stash ' + action + '（不可恢复）')
          const r = await execGitOk(['-C', root, 'stash', action], exec, 'git stash ' + action)
          return '已执行 git stash ' + action
        }
        throw new Error('未知 action: ' + action + '（支持 list/push/pop/apply/drop/clear）')
      },
    })

    // ---------- 网络：git_fetch ----------
    registerTool({
      name: 'git_fetch',
      description: '拉取远程引用（git fetch）。remote 指定远程名（默认 origin）。需要网络访问。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        remote: { type: 'string', description: '远程名（默认 origin）' },
      },
      output: TEXT_OUTPUT,
      timeoutMs: 120000,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const remote = (typeof args.remote === 'string' && args.remote.trim()) ? args.remote.trim() : 'origin'
        const r = await execGitOk(['-C', root, 'fetch', remote], exec, 'git fetch')
        const text = (r.stdout || r.stderr || '').trim()
        return '已从 ' + remote + ' 拉取' + (text ? ':\n' + text : '')
      },
    })

    // ---------- 网络：git_pull ----------
    registerTool({
      name: 'git_pull',
      description: '拉取并合并远程分支（git pull）。remote/branch 可选（默认按上游配置）；rebase=true 时用 rebase 代替 merge。需要网络访问。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        remote: { type: 'string', description: '远程名（默认 origin）' },
        branch: { type: 'string', description: '远程分支名（可选）' },
        rebase: { type: 'boolean', description: '使用 rebase（默认 false）' },
      },
      output: TEXT_OUTPUT,
      timeoutMs: 180000,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const argv = ['-C', root, 'pull']
        if (args.rebase) argv.push('--rebase')
        const remote = (typeof args.remote === 'string' && args.remote.trim()) ? args.remote.trim() : null
        const branch = (typeof args.branch === 'string' && args.branch.trim()) ? args.branch.trim() : null
        if (remote) argv.push(remote)
        if (branch) argv.push(branch)
        const r = await execGitOk(argv, exec, 'git pull')
        const text = (r.stdout || r.stderr || '').trim()
        return 'pull 完成' + (text ? ':\n' + text : '')
      },
    })

    // ---------- 网络：git_push ----------
    registerTool({
      name: 'git_push',
      description: '推送本地提交到远程（git push）。remote 默认 origin；branch 可选（默认当前分支）；setUpstream=true 时设置上游（-u）；force=true 强制推送（危险操作需确认，会覆盖远端历史）。需要网络访问。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        remote: { type: 'string', description: '远程名（默认 origin）' },
        branch: { type: 'string', description: '分支名（可选，默认当前分支）' },
        setUpstream: { type: 'boolean', description: '设置上游跟踪（-u，默认 false）' },
        force: { type: 'boolean', description: '强制推送（危险操作）' },
        confirm: { type: 'boolean', description: '危险操作确认（force 时必填 true）' },
      },
      output: TEXT_OUTPUT,
      timeoutMs: 180000,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const argv = ['-C', root, 'push']
        if (args.setUpstream) argv.push('-u')
        const force = args.force === true
        if (force) {
          await requireConfirm(exec, args, 'git_push', '强制推送（--force，覆盖远端历史）')
          argv.push('--force')
        }
        const remote = (typeof args.remote === 'string' && args.remote.trim()) ? args.remote.trim() : null
        const branch = (typeof args.branch === 'string' && args.branch.trim()) ? args.branch.trim() : null
        if (remote) argv.push(remote)
        if (branch) argv.push(branch)
        const r = await execGitOk(argv, exec, 'git push')
        const text = (r.stdout || r.stderr || '').trim()
        return '推送完成' + (text ? ':\n' + text : '')
      },
    })

    // ---------- 写：git_tag ----------
    registerTool({
      name: 'git_tag',
      description: '标签管理。action=list 列出标签（默认）；create 新建（name 必填，target 可选指向提交）；delete 删除（危险，需确认）。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        action: { type: 'string', description: 'list / create / delete（默认 list）' },
        name: { type: 'string', description: '标签名（create/delete 必填）' },
        target: { type: 'string', description: 'create 时的目标提交（默认 HEAD）' },
        confirm: { type: 'boolean', description: '危险操作确认（delete 时必填 true）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const action = (typeof args.action === 'string' && args.action) ? args.action : 'list'
        if (action === 'list') {
          const r = await execGitOk(['-C', root, 'tag', '--sort=-creatordate'], exec, 'git tag')
          return r.stdout.trim() ? '标签列表:\n' + r.stdout.trim() : '（无标签）'
        }
        const name = String(args.name || '').trim()
        if (!name) throw new Error('action=' + action + ' 需要 name 参数')
        if (action === 'create') {
          const argv = ['-C', root, 'tag']
          const target = (typeof args.target === 'string' && args.target.trim()) ? args.target.trim() : null
          if (target) argv.push(name, target)
          else argv.push(name)
          await execGitOk(argv, exec, 'git tag')
          return '已创建标签 ' + name + (target ? '（指向 ' + target + '）' : '')
        }
        if (action === 'delete') {
          await requireConfirm(exec, args, 'git_tag', '删除标签 ' + name)
          await execGitOk(['-C', root, 'tag', '-d', name], exec, 'git tag -d')
          return '已删除标签 ' + name
        }
        throw new Error('未知 action: ' + action + '（支持 list/create/delete）')
      },
    })

    // ---------- 写：git_clean ----------
    registerTool({
      name: 'git_clean',
      description: '清理未跟踪文件。dryRun=true（默认）只列出将删除的文件不实际删除；dryRun=false 实际删除（危险操作需确认，不可恢复）。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        dryRun: { type: 'boolean', description: '只预览不删除（默认 true）' },
        confirm: { type: 'boolean', description: '危险操作确认（dryRun=false 时必填 true）' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const dry = !(args.dryRun === false)
        if (dry) {
          const r = await execGitOk(['-C', root, 'clean', '-nd'], exec, 'git clean -nd')
          return r.stdout.trim() ? '将删除以下未跟踪文件（用 dryRun=false + confirm=true 执行）:\n' + r.stdout.trim() : '（没有可清理的未跟踪文件）'
        }
        await requireConfirm(exec, args, 'git_clean', '删除所有未跟踪文件（git clean -fd，不可恢复）')
        const r = await execGitOk(['-C', root, 'clean', '-fd'], exec, 'git clean -fd')
        return '已清理未跟踪文件' + (r.stdout.trim() ? ':\n' + r.stdout.trim() : '')
      },
    })

    // ---------- 兜底：git_run ----------
    registerTool({
      name: 'git_run',
      description: '执行任意 git 子命令（白名单外兜底）。args 为参数数组（如 ["log","--oneline","-5"]）。属于危险操作：必须 confirm=true 且需会话审批通过。',
      parameters: {
        repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
        args: { type: 'array', items: { type: 'string' }, required: true, description: 'git 参数数组（不含 git 本身）' },
        confirm: { type: 'boolean', required: true, description: '必须为 true（危险操作确认）' },
      },
      output: TEXT_OUTPUT,
      timeoutMs: 120000,
      async execute(args, exec) {
        const root = await repoRootOf(exec, args.repoPath)
        const cmd = pathList(args, 'args')
        await requireConfirm(exec, args, 'git_run', '执行任意 git 命令: git ' + cmd.join(' '))
        const r = await execGit(['-C', root].concat(cmd), exec)
        if (r.exitCode !== 0) {
          return 'git ' + cmd.join(' ') + ' 退出码 ' + r.exitCode + ':\n' + (r.stderr || r.stdout || '').slice(0, 1000)
        }
        return cap(r.stdout.trim() || '(无输出)', 200000, '输出过大')
      },
    })

    // ================= RPC（面板用；repoPath 必传） =================
    function rpcWrap(handler) {
      return async function (args) {
        try {
          return await handler(args || {})
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) }
        }
      }
    }

    harness.handle('git.panelState', rpcWrap(async function (args) {
      const s = await statusObject(null, args.repoPath)
      const logR = await execGit(['-C', s.root, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', '15'], null)
      const branchR = await execGit(['-C', s.root, 'branch', '--format=%(refname:short)|%(HEAD)|%(upstream:short)'], null)
      const cfg = await readConfig()
      const branches = branchR.exitCode === 0 ? branchR.stdout.split('\n').filter(function (l) { return l.trim() }) : []
      return {
        ok: true,
        status: s,
        log: logR.exitCode === 0 ? logR.stdout.trim() : '',
        branches: branches.map(function (l) {
          const p = l.split('|')
          return { name: p[0] || l, current: p[1] === '*', upstream: p[2] || '' }
        }),
        commitModel: cfg.commitModel,
      }
    }))

    harness.handle('git.stage', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const paths = pathList(args, 'paths')
      await execGitOk(['-C', root, 'add', '--'].concat(paths), null, 'git add')
      return { ok: true, message: '已暂存 ' + paths.length + ' 个文件' }
    }))

    harness.handle('git.unstage', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const paths = pathList(args, 'paths')
      await execGitOk(['-C', root, 'restore', '--staged', '--'].concat(paths), null, 'git restore --staged')
      return { ok: true, message: '已取消暂存 ' + paths.length + ' 个文件' }
    }))

    harness.handle('git.commit', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const message = String(args.message || '').trim()
      if (!message) return { ok: false, error: '缺少 message' }
      const argv = ['-C', root, 'commit']
      if (args.amend) argv.push('--amend')
      argv.push('-m', message)
      const r = await execGitOk(argv, null, 'git commit')
      const summary = await execGit(['-C', root, 'log', '-1', '--pretty=format:%h|%s'], null)
      return { ok: true, message: '提交完成: ' + (summary.stdout || '').trim() + ((r.stdout || r.stderr || '').trim() ? '\n' + (r.stdout || r.stderr || '').trim() : '') }
    }))

    harness.handle('git.commitMessage', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const msg = await generateCommitMessage(null, root, undefined)
      return { ok: true, message: msg }
    }))

    harness.handle('git.diff', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const head = args.staged ? ['--cached'] : ['HEAD']
      const tail = (typeof args.path === 'string' && args.path.trim()) ? ['--', args.path.trim()] : []
      const r = await execGitOk(['-C', root, 'diff'].concat(head, tail), null, 'git diff')
      return { ok: true, text: r.stdout.trim() ? cap(r.stdout, 200000, '建议用 stat 或 path 缩小范围') : '(无变更)' }
    }))

    harness.handle('git.log', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const n = Math.min(Math.max(1, Number(args.n) || 20), 100)
      const r = await execGitOk(['-C', root, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', String(n)], null, 'git log')
      return { ok: true, text: r.stdout.trim() ? r.stdout : '(无提交记录)' }
    }))

    harness.handle('git.branch', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const action = (typeof args.action === 'string' && args.action) ? args.action : 'list'
      if (action === 'list') {
        const r = await execGitOk(['-C', root, 'branch', '--format=%(refname:short)|%(HEAD)|%(upstream:short)'], null, 'git branch')
        const lines = r.stdout.split('\n').filter(function (l) { return l.trim() })
        return { ok: true, branches: lines.map(function (l) { const p = l.split('|'); return { name: p[0] || l, current: p[1] === '*', upstream: p[2] || '' } }) }
      }
      const name = String(args.name || '').trim()
      if (!name) return { ok: false, error: '缺少 name' }
      if (action === 'create') {
        const argv = ['-C', root, 'branch']
        const from = (typeof args.from === 'string' && args.from.trim()) ? args.from.trim() : null
        if (from) argv.push(name, from); else argv.push(name)
        await execGitOk(argv, null, 'git branch')
        return { ok: true, message: '已创建分支 ' + name }
      }
      if (action === 'switch') {
        const argv = ['-C', root, 'checkout']
        if (args.create) argv.push('-b')
        argv.push(name)
        await execGitOk(argv, null, 'git checkout')
        return { ok: true, message: '已切换到分支 ' + name }
      }
      if (action === 'delete') {
        if (!(args.confirm === true)) return { ok: false, error: '删除分支需要确认（confirm=true）' }
        const flag = args.force ? '-D' : '-d'
        await execGitOk(['-C', root, 'branch', flag, name], null, 'git branch ' + flag)
        return { ok: true, message: '已删除分支 ' + name }
      }
      return { ok: false, error: '未知 action: ' + action }
    }))

    harness.handle('git.checkout', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const target = String(args.target || '').trim()
      if (!target) return { ok: false, error: '缺少 target' }
      const argv = ['-C', root, 'checkout']
      if (args.create) argv.push('-b')
      if (args.force) {
        if (!(args.confirm === true)) return { ok: false, error: '强制切换需要确认（confirm=true）' }
        argv.push('-f')
      }
      argv.push(target)
      await execGitOk(argv, null, 'git checkout')
      return { ok: true, message: '已切换到分支 ' + target }
    }))

    harness.handle('git.pull', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const argv = ['-C', root, 'pull']
      if (args.rebase) argv.push('--rebase')
      const remote = (typeof args.remote === 'string' && args.remote.trim()) ? args.remote.trim() : null
      const branch = (typeof args.branch === 'string' && args.branch.trim()) ? args.branch.trim() : null
      if (remote) argv.push(remote)
      if (branch) argv.push(branch)
      const r = await execGitOk(argv, null, 'git pull')
      return { ok: true, message: (r.stdout || r.stderr || '').trim() || 'pull 完成' }
    }))

    harness.handle('git.push', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      if (args.force && !(args.confirm === true)) return { ok: false, error: '强制推送需要确认（confirm=true）' }
      const argv = ['-C', root, 'push']
      if (args.setUpstream) argv.push('-u')
      if (args.force) argv.push('--force')
      const remote = (typeof args.remote === 'string' && args.remote.trim()) ? args.remote.trim() : null
      const branch = (typeof args.branch === 'string' && args.branch.trim()) ? args.branch.trim() : null
      if (remote) argv.push(remote)
      if (branch) argv.push(branch)
      const r = await execGitOk(argv, null, 'git push')
      return { ok: true, message: (r.stdout || r.stderr || '').trim() || '推送完成' }
    }))

    harness.handle('git.reset', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const mode = (typeof args.mode === 'string' && args.mode) ? args.mode : 'mixed'
      if (mode === 'hard' && !(args.confirm === true)) return { ok: false, error: 'reset --hard 需要确认（confirm=true）' }
      const argv = ['-C', root, 'reset']
      if (mode === 'soft') argv.push('--soft')
      else if (mode === 'hard') argv.push('--hard')
      else if (mode !== 'mixed') return { ok: false, error: '未知 mode: ' + mode }
      argv.push((typeof args.target === 'string' && args.target.trim()) ? args.target.trim() : 'HEAD')
      await execGitOk(argv, null, 'git reset')
      return { ok: true, message: '已重置（mode=' + mode + '）' }
    }))

    harness.handle('git.clean', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const dry = !(args.dryRun === false)
      if (dry) {
        const r = await execGitOk(['-C', root, 'clean', '-nd'], null, 'git clean -nd')
        return { ok: true, message: r.stdout.trim() ? '将删除:\n' + r.stdout.trim() : '没有可清理的未跟踪文件', dryRun: true }
      }
      if (!(args.confirm === true)) return { ok: false, error: '清理需要确认（confirm=true）' }
      const r = await execGitOk(['-C', root, 'clean', '-fd'], null, 'git clean -fd')
      return { ok: true, message: '已清理' + (r.stdout.trim() ? ':\n' + r.stdout.trim() : '') }
    }))

    harness.handle('git.stash', rpcWrap(async function (args) {
      const root = await repoRootOf(null, args.repoPath)
      const action = (typeof args.action === 'string' && args.action) ? args.action : 'list'
      if (action === 'list') {
        const r = await execGitOk(['-C', root, 'stash', 'list'], null, 'git stash list')
        return { ok: true, message: r.stdout.trim() ? r.stdout : '（无 stash）' }
      }
      if (action === 'push') {
        const argv = ['-C', root, 'stash', 'push']
        const msg = (typeof args.message === 'string' && args.message.trim()) ? args.message.trim() : ''
        if (msg) argv.push('-m', msg)
        const r = await execGitOk(argv, null, 'git stash push')
        return { ok: true, message: (r.stdout || r.stderr || '').trim() || '已暂存工作区' }
      }
      if (action === 'pop' || action === 'apply') {
        const r = await execGitOk(['-C', root, 'stash', action], null, 'git stash ' + action)
        return { ok: true, message: (r.stdout || r.stderr || '').trim() || '完成' }
      }
      if (action === 'drop' || action === 'clear') {
        if (!(args.confirm === true)) return { ok: false, error: action + ' 需要确认（confirm=true）' }
        await execGitOk(['-C', root, 'stash', action], null, 'git stash ' + action)
        return { ok: true, message: '已执行 git stash ' + action }
      }
      return { ok: false, error: '未知 action: ' + action }
    }))
  },
}
