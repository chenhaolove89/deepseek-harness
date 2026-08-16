/**
 * dsh-git Host half: 20 structured git tools plus the Remote gateway serving
 * the Git panel and the Git settings page. Tools and gateway read the
 * `dsh-git` settings namespace (commitModel / autoRefreshMs).
 * @module @deepseek-ai/dsh-git
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-typert-protocol'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type {
  GitActionResult,
  GitBranchListResult,
  GitBranchRequest,
  GitBranchRow,
  GitCheckoutRequest,
  GitCleanRequest,
  GitCommitRequest,
  GitConfigPatch,
  GitConfigResult,
  GitDiffRequest,
  GitFileEntry,
  GitLogRequest,
  GitLogRow,
  GitPanelStateResult,
  GitPullRequest,
  GitPushRequest,
  GitRepoRequest,
  GitResetRequest,
  GitSettings,
  GitShowRequest,
  GitStageRequest,
  GitStashRequest,
  GitStatusView,
  GitTextResult,
} from './types.ts'

export type {
  GitActionResult,
  GitBranchListResult,
  GitBranchRequest,
  GitBranchRow,
  GitCheckoutRequest,
  GitCleanRequest,
  GitCommitRequest,
  GitConfigPatch,
  GitConfigResult,
  GitDiffRequest,
  GitFileEntry,
  GitLogRequest,
  GitLogRow,
  GitPanelStateResult,
  GitPullRequest,
  GitPushRequest,
  GitRepoRequest,
  GitResetRequest,
  GitSettings,
  GitShowRequest,
  GitStageRequest,
  GitStashRequest,
  GitStatusView,
  GitTextResult,
} from './types.ts'

/** Settings namespace owned by this plugin. */
export const GIT_SETTINGS_NAMESPACE = settingsNamespace('dsh-git')

/** Default commit-message route (overridable in the Git settings page). */
export const DEFAULT_COMMIT_MODEL = { provider: 'tokenrhythm', model: 'qwen3.8-max' } as const

/** Default reserved auto-refresh interval (ms). */
export const DEFAULT_AUTO_REFRESH_MS = 5000

/** Durable plugin schema; also the wire envelope the settings page validates against. */
export const GitSettingsSchema: z<GitSettings> = z.object({
  commitModel: z.object({
    provider: z.string().default(DEFAULT_COMMIT_MODEL.provider),
    model: z.string().default(DEFAULT_COMMIT_MODEL.model),
  }),
  autoRefreshMs: z.natural().min(1000).default(DEFAULT_AUTO_REFRESH_MS),
})

// ================= git 执行器（argv 直调，无 shell 注入） =================

interface GitOutcome {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

async function execGit(ctx: Context, args: readonly string[], signal?: AbortSignal): Promise<GitOutcome> {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('subprocess 服务不可用')
  let git = 'git'
  try {
    git = await subprocess.resolveExecutable('git')
  } catch {
    // PATH 兜底
  }
  const handle = subprocess.spawn({
    argv: [git, ...args],
    cwd: '',
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 32 * 1024 * 1024 },
      stderr: { maxBytes: 1024 * 1024 },
    },
    graceMs: 30000,
    signal,
  })
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  return { exitCode: outcome.exitCode ?? -1, stdout, stderr }
}

async function execGitOk(ctx: Context, args: readonly string[], label: string, signal?: AbortSignal): Promise<GitOutcome> {
  const r = await execGit(ctx, args, signal)
  if (r.exitCode !== 0) {
    throw new Error(`${label} 失败: ${(r.stderr || r.stdout || '未知错误').slice(0, 500)}`)
  }
  return r
}

function sessionCwd(exec: { agent?: { session?: { header?: { cwd?: string } } } } | undefined): string | undefined {
  return exec?.agent?.session?.header?.cwd
}

async function repoRootOf(
  ctx: Context,
  repoPath: string | undefined,
  exec?: { agent?: { session?: { header?: { cwd?: string } } } },
): Promise<string> {
  const start = (typeof repoPath === 'string' && repoPath.trim()) ? repoPath.trim() : sessionCwd(exec)
  if (!start) throw new Error('无法确定仓库目录：请传 repoPath 或确认会话工作目录')
  const r = await execGit(ctx, ['-C', start, 'rev-parse', '--show-toplevel'])
  if (r.exitCode !== 0) {
    throw new Error(`不是 git 仓库（或 git 不可用）: ${start} — ${(r.stderr || r.stdout).slice(0, 300)}`)
  }
  return r.stdout.trim()
}

// ================= 配置（dsh-git settings 命名空间） =================

async function readConfig(ctx: Context): Promise<GitSettings> {
  const settings = ctx.get('settings')
  if (settings === undefined) {
    return { commitModel: { ...DEFAULT_COMMIT_MODEL }, autoRefreshMs: DEFAULT_AUTO_REFRESH_MS }
  }
  const section = settings.get(GIT_SETTINGS_NAMESPACE) as GitSettings | undefined
  if (section === undefined) {
    return { commitModel: { ...DEFAULT_COMMIT_MODEL }, autoRefreshMs: DEFAULT_AUTO_REFRESH_MS }
  }
  return {
    commitModel: {
      provider: section.commitModel?.provider ?? DEFAULT_COMMIT_MODEL.provider,
      model: section.commitModel?.model ?? DEFAULT_COMMIT_MODEL.model,
    },
    autoRefreshMs: section.autoRefreshMs ?? DEFAULT_AUTO_REFRESH_MS,
  }
}

async function saveConfig(ctx: Context, patch: GitConfigPatch): Promise<void> {
  const settings = ctx.get('settings')
  if (settings === undefined) throw new Error('settings 服务不可用')
  await settings.update(GIT_SETTINGS_NAMESPACE, patch)
}

// ================= 危险操作审批门 =================

async function gateDanger(ctx: Context, exec: { agent?: Agent } | undefined, toolName: string, reason: string): Promise<void> {
  const approval = ctx.get('approval')
  if (approval === undefined) return
  const agent = exec?.agent
  if (agent === undefined) return
  const request: ApprovalRequest = { agent, toolName, reason }
  const outcome = await approval.request(request)
  if (outcome !== 'allowed-once') {
    throw new Error(`危险操作未获批准（${outcome}）：${reason}`)
  }
}

function requireConfirm(
  ctx: Context,
  exec: { agent?: Agent } | undefined,
  args: { confirm?: boolean } | undefined,
  toolName: string,
  reason: string,
): Promise<void> {
  if (!(args && args.confirm === true)) {
    throw new Error(`危险操作需要显式确认：请设置 confirm: true（并在征得用户同意后执行）—— ${reason}`)
  }
  return gateDanger(ctx, exec, toolName, reason)
}

function pathList(args: { paths?: unknown } | undefined): string[] {
  const raw = args?.paths
  const list = Array.isArray(raw) ? raw.map(String) : []
  if (list.length === 0) throw new Error('缺少 paths 参数（非空字符串数组）')
  return list
}

function cap(text: string, max: number, note: string): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n[输出已截断（${text.length} 字节），${note}]`
}

// ================= status 解析（porcelain v2） =================

function parseStatus(text: string): Omit<GitStatusView, 'root' | 'clean'> {
  const staged: GitFileEntry[] = []
  const unstaged: GitFileEntry[] = []
  const untracked: GitFileEntry[] = []
  const conflicts: GitFileEntry[] = []
  const out = { head: '', upstream: '', ahead: 0, behind: 0, staged, unstaged, untracked, conflicts }
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      out.head = line.slice('# branch.head '.length).trim()
    } else if (line.startsWith('# branch.upstream ')) {
      out.upstream = line.slice('# branch.upstream '.length).trim()
    } else if (line.startsWith('# branch.ab +')) {
      const m = line.match(/\+(\d+) -(\d+)/)
      if (m) {
        out.ahead = Number(m[1])
        out.behind = Number(m[2])
      }
    } else if (line.startsWith('? ')) {
      untracked.push({ xy: '??', path: line.slice(2), x: '?', y: '?' })
    } else if (line.startsWith('u ')) {
      const parts = line.split(' ')
      conflicts.push({ xy: parts[1] ?? '', path: parts.slice(9).join(' '), x: (parts[1] ?? '')[0] ?? '', y: (parts[1] ?? '')[1] ?? '' })
    } else if (line.startsWith('1 ')) {
      const parts = line.split(' ')
      const xy = parts[1] ?? ''
      const path = parts.slice(8).join(' ')
      const x = xy[0] ?? ''
      const y = xy[1] ?? ''
      const entry: GitFileEntry = { xy, path, x, y }
      if (x !== '.' && x !== '?') staged.push(entry)
      if (y !== '.' && x !== '?') unstaged.push(entry)
    } else if (line.startsWith('2 ')) {
      const parts = line.split(' ')
      const xy = parts[1] ?? ''
      const x = xy[0] ?? ''
      const y = xy[1] ?? ''
      const rest = parts.slice(9).join(' ')
      const sep = rest.indexOf('\t')
      const path = sep >= 0 ? rest.slice(0, sep) : rest
      const orig = sep >= 0 ? rest.slice(sep + 1) : ''
      const entry: GitFileEntry = { xy, path, x, y, orig }
      if (x !== '.' && x !== '?') staged.push(entry)
      if (y !== '.' && x !== '?') unstaged.push(entry)
    }
  }
  return out
}

function statusObject(
  ctx: Context,
  repoPath: string | undefined,
  exec?: { agent?: { session?: { header?: { cwd?: string } } } },
): Promise<GitStatusView> {
  return repoRootOf(ctx, repoPath, exec).then(async (root) => {
    const r = await execGit(ctx, ['-C', root, 'status', '--porcelain=v2', '-b'])
    if (r.exitCode !== 0) throw new Error(`git status 失败: ${(r.stderr || r.stdout).slice(0, 300)}`)
    const s = parseStatus(r.stdout)
    const clean = s.staged.length + s.unstaged.length + s.untracked.length + s.conflicts.length === 0
    return { ...s, root, clean }
  })
}

// ================= 提交信息 AI 生成 =================

function commitPrompt(diffText: string, history: string): string {
  return '你是资深工程师。请根据下面的 git 变更生成一条 Conventional Commits 格式的提交信息。\n'
    + '要求：\n'
    + '1. 第一行格式: type(scope): subject（type ∈ feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert，scope 可选，subject 用祈使句、不超过 72 字符）\n'
    + '2. 如变更较复杂，空一行后附简短正文（bullet 列表说明要点），最多 5 行\n'
    + '3. 语言与仓库近期提交风格保持一致\n'
    + '4. 只输出提交信息本身，不要任何解释、引号或 markdown 代码块\n\n'
    + `仓库近期提交风格参考：\n${history || '（无历史）'}\n\n`
    + `变更内容（git diff --cached）：\n${diffText || '（暂存区为空）'}`
}

async function generateCommitMessage(ctx: Context, repoPath: string, signal?: AbortSignal): Promise<string> {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('llm 服务不可用（提交信息生成需要）')
  const cfg = await readConfig(ctx)
  const route = cfg.commitModel
  let found = false
  try {
    const models = await llm.listModels(route.provider)
    found = Array.isArray(models) && models.some(m => m.id === route.model)
  } catch {
    found = false
  }
  if (!found) {
    throw new Error(`提交信息生成路由不可用: ${route.provider}/${route.model}（请在「Git 管理」设置页配置 commitModel，或先导入该供应商）`)
  }
  const diffR = await execGit(ctx, ['-C', repoPath, 'diff', '--cached'], signal)
  if (diffR.exitCode !== 0) throw new Error(`读取暂存区失败: ${(diffR.stderr || diffR.stdout).slice(0, 300)}`)
  const logR = await execGit(ctx, ['-C', repoPath, 'log', '--pretty=format:%s', '-n', '15'], signal)
  const diffText = diffR.stdout.slice(0, 60000)
  const history = logR.stdout.trim()
  const prompt = commitPrompt(diffText, history)
  const message = createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  })
  let out = ''
  let sawDelta = false
  let finish: { reason?: { kind?: string; failure?: { message?: string; code?: string } } } | null = null
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    messages: [message],
    ...(signal !== undefined ? { signal } : {}),
    maxTokens: 2048,
  })) {
    if (chunk.type === 'text-delta') {
      out += chunk.text
      sawDelta = true
    } else if (chunk.type === 'block-end' && chunk.block.type === 'text' && !sawDelta) {
      out += chunk.block.text
    } else if (chunk.type === 'finish') {
      finish = chunk
    }
  }
  if (finish?.reason?.kind === 'error') {
    const f = finish.reason.failure
    throw new Error(`模型调用失败: ${String((f && (f.message || f.code)) || '未知错误')}`)
  }
  const msg = out.trim()
  if (!msg) throw new Error('模型未生成提交信息（返回为空）')
  return msg
}

// ================= 工具注册 =================

const TEXT_OUTPUT = {
  schema: { type: 'string' } as const,
  render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: String(value) }],
}

/** Register every git tool on the caller's tools registry. */
export function registerGitTools(ctx: Context): void {
  // ---------- 只读：git_status ----------
  ctx.tools.register(defineTool({
    name: 'git_status',
    description: '查看 git 仓库状态：当前分支、ahead/behind 同步状态、变更文件（按已暂存/未暂存/未跟踪/冲突分组）。repoPath 可指定仓库目录（默认当前会话工作目录，自动向上查找仓库根）。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string }, exec) {
      const s = await statusObject(ctx, args.repoPath, exec)
      return formatStatus(s)
    },
  }))

  // ---------- 只读：git_diff ----------
  ctx.tools.register(defineTool({
    name: 'git_diff',
    description: '查看未提交变更的 diff。staged=true 查看已暂存区（--cached），staged=false 查看工作区相对 HEAD 的全部变更（含暂存）；stat=true 只输出文件统计（numstat）；path 可限定单个文件。大 diff 会被截断并给出提示。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      staged: { type: 'boolean', description: '是否查看暂存区（默认 false）' },
      stat: { type: 'boolean', description: '只输出统计（默认 false）' },
      path: { type: 'string', description: '限定文件路径（可选）' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; staged?: boolean; stat?: boolean; path?: string }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const head = args.staged ? ['--cached'] : ['HEAD']
      const tail = (typeof args.path === 'string' && args.path.trim()) ? ['--', args.path.trim()] : []
      if (args.stat) {
        const r = await execGitOk(ctx, ['-C', root, 'diff', ...head, '--numstat', ...tail], 'git diff', exec.signal)
        return r.stdout.trim() ? r.stdout : '(无变更)'
      }
      const r = await execGitOk(ctx, ['-C', root, 'diff', ...head, ...tail], 'git diff', exec.signal)
      if (!r.stdout.trim()) return '(无变更)'
      return cap(r.stdout, 200000, '建议用 stat=true 或 path 缩小范围')
    },
  }))

  // ---------- 只读：git_log ----------
  ctx.tools.register(defineTool({
    name: 'git_log',
    description: '查看提交历史，每行格式：短哈希|作者|日期|主题，最多 n 条（默认 20，上限 100）。path 可限定单个文件的历史。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      n: { type: 'integer', description: '条数（默认 20，上限 100）' },
      path: { type: 'string', description: '限定文件路径（可选）' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; n?: number; path?: string }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const n = Math.min(Math.max(1, Number(args.n) || 20), 100)
      const tail = (typeof args.path === 'string' && args.path.trim()) ? ['--', args.path.trim()] : []
      const r = await execGitOk(ctx, ['-C', root, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', String(n), ...tail], 'git log', exec.signal)
      return r.stdout.trim() ? r.stdout : '(无提交记录)'
    },
  }))

  // ---------- 只读：git_show ----------
  ctx.tools.register(defineTool({
    name: 'git_show',
    description: '查看某次提交的内容（diff）。commit 为提交引用（默认 HEAD）；stat=true 只出统计；path 限定文件。大输出会被截断。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      commit: { type: 'string', description: '提交引用（默认 HEAD）' },
      stat: { type: 'boolean', description: '只输出统计（默认 false）' },
      path: { type: 'string', description: '限定文件路径（可选）' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; commit?: string; stat?: boolean; path?: string }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const commit = (typeof args.commit === 'string' && args.commit.trim()) ? args.commit.trim() : 'HEAD'
      const tail = (typeof args.path === 'string' && args.path.trim()) ? ['--', args.path.trim()] : []
      const r = await execGitOk(ctx, ['-C', root, 'show', ...(args.stat ? ['--stat'] : []), '--format=medium', commit, ...tail], 'git show', exec.signal)
      return cap(r.stdout, 200000, '建议用 stat=true 或 path 缩小范围')
    },
  }))

  // ---------- 只读：git_blame ----------
  ctx.tools.register(defineTool({
    name: 'git_blame',
    description: '查看文件每行代码的提交归属（git blame）。path 必填；line 可指定单行（1-based）。输出格式：短哈希|作者|日期|行内容。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      path: { type: 'string', required: true, description: '文件路径' },
      line: { type: 'integer', description: '只看某一行（1-based，可选）' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; path?: string; line?: number }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const path = String(args.path ?? '').trim()
      if (!path) throw new Error('缺少 path 参数')
      const line = Number(args.line)
      const range = (Number.isInteger(line) && line > 0) ? ['-L', `${line},${line}`] : []
      const r = await execGitOk(ctx, ['-C', root, 'blame', '--date=short', '--pretty=format:%h|%an|%ad', ...range, '--', path], 'git blame', exec.signal)
      return cap(r.stdout, 200000, '建议用 line 参数缩小范围')
    },
  }))

  // ---------- 写：git_stage ----------
  ctx.tools.register(defineTool({
    name: 'git_stage',
    description: '把文件加入暂存区（git add）。paths 为相对仓库根的文件路径数组（可用 "." 表示全部）。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      paths: { type: 'array', items: { type: 'string' }, required: true, description: '要暂存的文件路径数组（"." 表示全部）' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; paths?: unknown }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const paths = pathList(args)
      const r = await execGitOk(ctx, ['-C', root, 'add', '--', ...paths], 'git add', exec.signal)
      const label = paths.length === 1 ? paths[0] : `${paths.length} 个文件`
      return `已暂存 ${label}${r.stdout.trim() ? `\n${r.stdout.trim()}` : ''}`
    },
  }))

  // ---------- 写：git_unstage ----------
  ctx.tools.register(defineTool({
    name: 'git_unstage',
    description: '把文件移出暂存区（git restore --staged，即取消暂存，不改动工作区内容）。paths 为文件路径数组。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      paths: { type: 'array', items: { type: 'string' }, required: true, description: '要取消暂存的文件路径数组' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; paths?: unknown }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const paths = pathList(args)
      await execGitOk(ctx, ['-C', root, 'restore', '--staged', '--', ...paths], 'git restore --staged', exec.signal)
      const label = paths.length === 1 ? paths[0] : `${paths.length} 个文件`
      return `已取消暂存 ${label}`
    },
  }))

  // ---------- 写：git_commit ----------
  ctx.tools.register(defineTool({
    name: 'git_commit',
    description: '创建提交（git commit -m）。message 必填（可用 git_commit_message 工具生成）；amend=true 时改写最近一次提交（需谨慎，推送过的提交改写后需 force push）。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      message: { type: 'string', required: true, description: '提交信息（第一行为主题，可含换行正文）' },
      amend: { type: 'boolean', description: '是否改写最近一次提交（默认 false）' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; message?: string; amend?: boolean }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const message = String(args.message ?? '').trim()
      if (!message) throw new Error('缺少 message 参数')
      const argv = ['-C', root, 'commit']
      if (args.amend) argv.push('--amend')
      argv.push('-m', message)
      const r = await execGitOk(ctx, argv, 'git commit', exec.signal)
      const summary = await execGitOk(ctx, ['-C', root, 'log', '-1', '--pretty=format:%h|%s'], 'git log', exec.signal)
      const result = (r.stdout || r.stderr || '').trim()
      return `提交完成: ${summary.stdout.trim() || ''}${result ? `\n${result}` : ''}`
    },
  }))

  // ---------- 写：git_commit_message（AI 生成） ----------
  ctx.tools.register(defineTool({
    name: 'git_commit_message',
    description: '根据暂存区（staged）的 diff 和仓库提交风格，用 LLM 生成一条 Conventional Commits 提交信息（默认 tokenrhythm/qwen3.8-max，可在「Git 管理」设置页的 commitModel 覆盖）。返回的信息可直接作为 git_commit 的 message。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
    },
    output: TEXT_OUTPUT,
    timeoutMs: 90000,
    async execute(args: { repoPath?: string }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      return generateCommitMessage(ctx, root, exec.signal)
    },
  }))

  // ---------- 写：git_branch ----------
  ctx.tools.register(defineTool({
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
    async execute(
      args: { repoPath?: string; action?: string; name?: string; from?: string; create?: boolean; force?: boolean; confirm?: boolean },
      exec,
    ) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const action = (typeof args.action === 'string' && args.action) ? args.action : 'list'
      if (action === 'list') {
        const r = await execGitOk(ctx, ['-C', root, 'branch', '--format=%(refname:short)|%(HEAD)|%(upstream:short)'], 'git branch', exec.signal)
        const lines = r.stdout.split('\n').filter(l => l.trim())
        const text = lines.map((l) => {
          const parts = l.split('|')
          const current = parts[1] === '*' ? ' *' : ''
          const upstream = parts[2] ? ` → ${parts[2]}` : ''
          return `${parts[0] || l}${current}${upstream}`
        }).join('\n')
        return `分支列表:\n${text || '（无分支）'}`
      }
      const name = String(args.name ?? '').trim()
      if (!name) throw new Error(`action=${action} 需要 name 参数`)
      if (action === 'create') {
        const argv = ['-C', root, 'branch']
        const from = (typeof args.from === 'string' && args.from.trim()) ? args.from.trim() : null
        if (from) argv.push(name, from)
        else argv.push(name)
        await execGitOk(ctx, argv, 'git branch', exec.signal)
        return `已创建分支 ${name}${from ? `（起点 ${from}）` : ''}`
      }
      if (action === 'switch') {
        const argv = ['-C', root, 'checkout']
        if (args.create) argv.push('-b')
        argv.push(name)
        await execGitOk(ctx, argv, 'git checkout', exec.signal)
        return `已切换到分支 ${name}`
      }
      if (action === 'delete') {
        if (args.force) {
          await requireConfirm(ctx, exec, args, 'git_branch', `强制删除分支 ${name}（-D）`)
          await execGitOk(ctx, ['-C', root, 'branch', '-D', name], 'git branch -D', exec.signal)
          return `已强制删除分支 ${name}`
        }
        await execGitOk(ctx, ['-C', root, 'branch', '-d', name], 'git branch -d', exec.signal)
        return `已删除分支 ${name}`
      }
      throw new Error(`未知 action: ${action}（支持 list/create/switch/delete）`)
    },
  }))

  // ---------- 写：git_checkout ----------
  ctx.tools.register(defineTool({
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
    async execute(args: { repoPath?: string; target?: string; create?: boolean; path?: string; force?: boolean; confirm?: boolean }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const path = (typeof args.path === 'string' && args.path.trim()) ? args.path.trim() : ''
      if (path) {
        await execGitOk(ctx, ['-C', root, 'checkout', '--', path], 'git checkout --', exec.signal)
        return `已恢复文件 ${path}（丢弃其未提交改动）`
      }
      const target = String(args.target ?? '').trim()
      if (!target) throw new Error('缺少 target 或 path 参数')
      const argv = ['-C', root, 'checkout']
      if (args.create) argv.push('-b')
      if (args.force) {
        await requireConfirm(ctx, exec, args, 'git_checkout', `强制切换分支 ${target}（丢弃本地改动）`)
        argv.push('-f')
      }
      argv.push(target)
      await execGitOk(ctx, argv, 'git checkout', exec.signal)
      return `已切换到分支 ${target}`
    },
  }))

  // ---------- 写：git_reset ----------
  ctx.tools.register(defineTool({
    name: 'git_reset',
    description: '重置提交指针与暂存区。mode=soft 只移动 HEAD 保留改动；mixed（默认）同时取消暂存；hard 丢弃所有未提交改动（危险操作需确认，不可恢复）。target 为重置目标（默认 HEAD）。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      mode: { type: 'string', description: 'soft / mixed / hard（默认 mixed）' },
      target: { type: 'string', description: '重置目标提交（默认 HEAD）' },
      confirm: { type: 'boolean', description: '危险操作确认（mode=hard 时必填 true）' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; mode?: string; target?: string; confirm?: boolean }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const mode = (typeof args.mode === 'string' && args.mode) ? args.mode : 'mixed'
      const target = (typeof args.target === 'string' && args.target.trim()) ? args.target.trim() : 'HEAD'
      const argv = ['-C', root, 'reset']
      if (mode === 'soft') argv.push('--soft')
      else if (mode === 'mixed') argv.push('--mixed')
      else if (mode === 'hard') {
        await requireConfirm(ctx, exec, args, 'git_reset', `git reset --hard ${target}（丢弃所有未提交改动，不可恢复）`)
        argv.push('--hard')
      } else {
        throw new Error(`未知 mode: ${mode}（支持 soft/mixed/hard）`)
      }
      argv.push(target)
      await execGitOk(ctx, argv, 'git reset', exec.signal)
      return `已重置到 ${target}（mode=${mode}）`
    },
  }))

  // ---------- 写：git_revert ----------
  ctx.tools.register(defineTool({
    name: 'git_revert',
    description: '撤销指定提交（生成一个反向提交，git revert --no-edit）。commit 必填。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      commit: { type: 'string', required: true, description: '要撤销的提交引用' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; commit?: string }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const commit = String(args.commit ?? '').trim()
      if (!commit) throw new Error('缺少 commit 参数')
      const r = await execGitOk(ctx, ['-C', root, 'revert', '--no-edit', commit], 'git revert', exec.signal)
      return `已撤销提交 ${commit}\n${(r.stdout || r.stderr || '').trim()}`
    },
  }))

  // ---------- 写：git_stash ----------
  ctx.tools.register(defineTool({
    name: 'git_stash',
    description: '暂存/恢复工作区。action=list 列出（默认）；push 保存（message 可选备注）；pop 恢复最近一条并删除；apply 恢复但不删除；drop 删除指定条目（危险，需确认）；clear 清空全部（危险，需确认）。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      action: { type: 'string', description: 'list / push / pop / apply / drop / clear（默认 list）' },
      message: { type: 'string', description: 'push 时的备注（可选）' },
      confirm: { type: 'boolean', description: '危险操作确认（drop/clear 时必填 true）' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; action?: string; message?: string; confirm?: boolean }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const action = (typeof args.action === 'string' && args.action) ? args.action : 'list'
      if (action === 'list') {
        const r = await execGitOk(ctx, ['-C', root, 'stash', 'list'], 'git stash list', exec.signal)
        return r.stdout.trim() ? `stash 列表:\n${r.stdout.trim()}` : '（无 stash）'
      }
      if (action === 'push') {
        const argv = ['-C', root, 'stash', 'push']
        const msg = (typeof args.message === 'string' && args.message.trim()) ? args.message.trim() : ''
        if (msg) argv.push('-m', msg)
        const r = await execGitOk(ctx, argv, 'git stash push', exec.signal)
        return `已暂存工作区${msg ? `（${msg}）` : ''}\n${(r.stdout || r.stderr || '').trim()}`
      }
      if (action === 'pop' || action === 'apply') {
        const r = await execGitOk(ctx, ['-C', root, 'stash', action], `git stash ${action}`, exec.signal)
        return `已${action === 'pop' ? '恢复并删除' : '应用'}最新 stash\n${(r.stdout || r.stderr || '').trim()}`
      }
      if (action === 'drop' || action === 'clear') {
        await requireConfirm(ctx, exec, args, 'git_stash', `git stash ${action}（不可恢复）`)
        const r = await execGitOk(ctx, ['-C', root, 'stash', action], `git stash ${action}`, exec.signal)
        return `已执行 git stash ${action}${(r.stdout || r.stderr || '').trim() ? `\n${(r.stdout || r.stderr || '').trim()}` : ''}`
      }
      throw new Error(`未知 action: ${action}（支持 list/push/pop/apply/drop/clear）`)
    },
  }))

  // ---------- 网络：git_fetch ----------
  ctx.tools.register(defineTool({
    name: 'git_fetch',
    description: '拉取远程引用（git fetch）。remote 指定远程名（默认 origin）。需要网络访问。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      remote: { type: 'string', description: '远程名（默认 origin）' },
    },
    output: TEXT_OUTPUT,
    timeoutMs: 120000,
    async execute(args: { repoPath?: string; remote?: string }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const remote = (typeof args.remote === 'string' && args.remote.trim()) ? args.remote.trim() : 'origin'
      const r = await execGitOk(ctx, ['-C', root, 'fetch', remote], 'git fetch', exec.signal)
      const text = (r.stdout || r.stderr || '').trim()
      return `已从 ${remote} 拉取${text ? `:\n${text}` : ''}`
    },
  }))

  // ---------- 网络：git_pull ----------
  ctx.tools.register(defineTool({
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
    async execute(args: { repoPath?: string; remote?: string; branch?: string; rebase?: boolean }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const argv = ['-C', root, 'pull']
      if (args.rebase) argv.push('--rebase')
      const remote = (typeof args.remote === 'string' && args.remote.trim()) ? args.remote.trim() : null
      const branch = (typeof args.branch === 'string' && args.branch.trim()) ? args.branch.trim() : null
      if (remote) argv.push(remote)
      if (branch) argv.push(branch)
      const r = await execGitOk(ctx, argv, 'git pull', exec.signal)
      const text = (r.stdout || r.stderr || '').trim()
      return `pull 完成${text ? `:\n${text}` : ''}`
    },
  }))

  // ---------- 网络：git_push ----------
  ctx.tools.register(defineTool({
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
    async execute(
      args: { repoPath?: string; remote?: string; branch?: string; setUpstream?: boolean; force?: boolean; confirm?: boolean },
      exec,
    ) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const argv = ['-C', root, 'push']
      if (args.setUpstream) argv.push('-u')
      const force = args.force === true
      if (force) {
        await requireConfirm(ctx, exec, args, 'git_push', '强制推送（--force，覆盖远端历史）')
        argv.push('--force')
      }
      const remote = (typeof args.remote === 'string' && args.remote.trim()) ? args.remote.trim() : null
      const branch = (typeof args.branch === 'string' && args.branch.trim()) ? args.branch.trim() : null
      if (remote) argv.push(remote)
      if (branch) argv.push(branch)
      const r = await execGitOk(ctx, argv, 'git push', exec.signal)
      const text = (r.stdout || r.stderr || '').trim()
      return `推送完成${text ? `:\n${text}` : ''}`
    },
  }))

  // ---------- 写：git_tag ----------
  ctx.tools.register(defineTool({
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
    async execute(args: { repoPath?: string; action?: string; name?: string; target?: string; confirm?: boolean }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const action = (typeof args.action === 'string' && args.action) ? args.action : 'list'
      if (action === 'list') {
        const r = await execGitOk(ctx, ['-C', root, 'tag', '--sort=-creatordate'], 'git tag', exec.signal)
        return r.stdout.trim() ? `标签列表:\n${r.stdout.trim()}` : '（无标签）'
      }
      const name = String(args.name ?? '').trim()
      if (!name) throw new Error(`action=${action} 需要 name 参数`)
      if (action === 'create') {
        const argv = ['-C', root, 'tag']
        const target = (typeof args.target === 'string' && args.target.trim()) ? args.target.trim() : null
        if (target) argv.push(name, target)
        else argv.push(name)
        await execGitOk(ctx, argv, 'git tag', exec.signal)
        return `已创建标签 ${name}${target ? `（指向 ${target}）` : ''}`
      }
      if (action === 'delete') {
        await requireConfirm(ctx, exec, args, 'git_tag', `删除标签 ${name}`)
        await execGitOk(ctx, ['-C', root, 'tag', '-d', name], 'git tag -d', exec.signal)
        return `已删除标签 ${name}`
      }
      throw new Error(`未知 action: ${action}（支持 list/create/delete）`)
    },
  }))

  // ---------- 写：git_clean ----------
  ctx.tools.register(defineTool({
    name: 'git_clean',
    description: '清理未跟踪文件。dryRun=true（默认）只列出将删除的文件不实际删除；dryRun=false 实际删除（危险操作需确认，不可恢复）。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      dryRun: { type: 'boolean', description: '只预览不删除（默认 true）' },
      confirm: { type: 'boolean', description: '危险操作确认（dryRun=false 时必填 true）' },
    },
    output: TEXT_OUTPUT,
    async execute(args: { repoPath?: string; dryRun?: boolean; confirm?: boolean }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const dry = !(args.dryRun === false)
      if (dry) {
        const r = await execGitOk(ctx, ['-C', root, 'clean', '-nd'], 'git clean -nd', exec.signal)
        return r.stdout.trim() ? `将删除以下未跟踪文件（用 dryRun=false + confirm=true 执行）:\n${r.stdout.trim()}` : '（没有可清理的未跟踪文件）'
      }
      await requireConfirm(ctx, exec, args, 'git_clean', '删除所有未跟踪文件（git clean -fd，不可恢复）')
      const r = await execGitOk(ctx, ['-C', root, 'clean', '-fd'], 'git clean -fd', exec.signal)
      return `已清理未跟踪文件${r.stdout.trim() ? `:\n${r.stdout.trim()}` : ''}`
    },
  }))

  // ---------- 兜底：git_run ----------
  ctx.tools.register(defineTool({
    name: 'git_run',
    description: '执行任意 git 子命令（白名单外兜底）。args 为参数数组（如 ["log","--oneline","-5"]）。属于危险操作：必须 confirm=true 且需会话审批通过。',
    parameters: {
      repoPath: { type: 'string', description: '仓库目录（可选，默认当前会话工作目录）' },
      args: { type: 'array', items: { type: 'string' }, required: true, description: 'git 参数数组（不含 git 本身）' },
      confirm: { type: 'boolean', required: true, description: '必须为 true（危险操作确认）' },
    },
    output: TEXT_OUTPUT,
    timeoutMs: 120000,
    async execute(args: { repoPath?: string; args?: unknown; confirm?: boolean }, exec) {
      const root = await repoRootOf(ctx, args.repoPath, exec)
      const cmd = pathList({ paths: args.args })
      await requireConfirm(ctx, exec, args, 'git_run', `执行任意 git 命令: git ${cmd.join(' ')}`)
      const r = await execGit(ctx, ['-C', root, ...cmd], exec.signal)
      if (r.exitCode !== 0) {
        return `git ${cmd.join(' ')} 退出码 ${r.exitCode}:\n${(r.stderr || r.stdout || '').slice(0, 1000)}`
      }
      return cap(r.stdout.trim() || '(无输出)', 200000, '输出过大')
    },
  }))
}

function formatStatus(s: GitStatusView): string {
  const letter = (x: string): string => (
    { M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', U: '冲突', '?': '未跟踪' } as Record<string, string>
  )[x] || x
  const lines: string[] = [`仓库: ${s.root}`]
  lines.push(s.head ? `分支: ${s.head}` : '分支: (无 HEAD / 未提交)' + (s.upstream ? `（上游: ${s.upstream}）` : ''))
  if (s.ahead || s.behind) lines.push(`同步状态: ahead ${s.ahead} / behind ${s.behind}`)
  if (s.conflicts.length) {
    lines.push(`冲突 (${s.conflicts.length}):`)
    for (const c of s.conflicts) lines.push(`  ${letter(c.y || 'U')}  ${c.path}`)
  }
  if (s.staged.length) {
    lines.push(`已暂存 (${s.staged.length}):`)
    for (const e of s.staged) lines.push(`  ${letter(e.x)}${e.orig ? `  ${e.path} ← ${e.orig}` : `  ${e.path}`}`)
  }
  if (s.unstaged.length) {
    lines.push(`未暂存 (${s.unstaged.length}):`)
    for (const e of s.unstaged) lines.push(`  ${letter(e.y)}${e.orig ? `  ${e.path} ← ${e.orig}` : `  ${e.path}`}`)
  }
  if (s.untracked.length) {
    lines.push(`未跟踪 (${s.untracked.length}):`)
    for (const u of s.untracked) lines.push(`  ?  ${u.path}`)
  }
  if (s.staged.length + s.unstaged.length + s.untracked.length + s.conflicts.length === 0) {
    lines.push('工作区干净')
  }
  return lines.join('\n')
}

// ================= Remote gateway（面板 + 设置页） =================

async function parseLogText(text: string): Promise<readonly GitLogRow[]> {
  return text.split('\n').filter(l => l.trim()).map((line) => {
    const p = line.split('|')
    return { hash: p[0] ?? '', author: p[1] ?? '', date: p[2] ?? '', subject: p[3] ?? '' }
  })
}

async function parseBranchText(text: string): Promise<readonly GitBranchRow[]> {
  return text.split('\n').filter(l => l.trim()).map((l) => {
    const p = l.split('|')
    return { name: p[0] || l, current: p[1] === '*', upstream: p[2] ?? '' }
  })
}

/** Remote gateway serving the Git panel and the Git settings page. */
export class GitGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'git')
  }

  /** Panel bootstrap: status + recent log + branches + active config. */
  @Remote('panelState')
  async panelState(args: GitRepoRequest): Promise<GitPanelStateResult> {
    try {
      let status: GitStatusView | null
      try {
        status = await statusObject(this.ctx, args.repoPath)
      } catch (error) {
        return {
          ok: true,
          status: null,
          notARepo: String((error instanceof Error && error.message) || error),
          log: [],
          branches: [],
          commitModel: { ...DEFAULT_COMMIT_MODEL },
        }
      }
      const logR = await execGit(this.ctx, ['-C', status.root, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', '15'])
      const branchR = await execGit(this.ctx, ['-C', status.root, 'branch', '--format=%(refname:short)|%(HEAD)|%(upstream:short)'])
      const cfg = await readConfig(this.ctx)
      return {
        ok: true,
        status,
        log: logR.exitCode === 0 ? await parseLogText(logR.stdout) : [],
        branches: branchR.exitCode === 0 ? await parseBranchText(branchR.stdout) : [],
        commitModel: cfg.commitModel,
      }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Stage paths. */
  @Remote('stage')
  async stage(args: GitStageRequest): Promise<GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const paths = pathList(args)
      await execGitOk(this.ctx, ['-C', root, 'add', '--', ...paths], 'git add')
      return { ok: true, message: `已暂存 ${paths.length} 个文件` }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Unstage paths. */
  @Remote('unstage')
  async unstage(args: GitStageRequest): Promise<GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const paths = pathList(args)
      await execGitOk(this.ctx, ['-C', root, 'restore', '--staged', '--', ...paths], 'git restore --staged')
      return { ok: true, message: `已取消暂存 ${paths.length} 个文件` }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Commit with the given message. */
  @Remote('commit')
  async commit(args: GitCommitRequest): Promise<GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const message = String(args.message ?? '').trim()
      if (!message) return { ok: false, error: '缺少 message' }
      const argv = ['-C', root, 'commit']
      if (args.amend) argv.push('--amend')
      argv.push('-m', message)
      const r = await execGitOk(this.ctx, argv, 'git commit')
      const summary = await execGit(this.ctx, ['-C', root, 'log', '-1', '--pretty=format:%h|%s'])
      const extra = (r.stdout || r.stderr || '').trim()
      return { ok: true, message: `提交完成: ${(summary.stdout || '').trim()}${extra ? `\n${extra}` : ''}` }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** AI-generate a commit message from the staged diff. */
  @Remote('commitMessage')
  async commitMessage(args: GitRepoRequest): Promise<GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const msg = await generateCommitMessage(this.ctx, root)
      return { ok: true, message: msg }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Show one commit's diff. */
  @Remote('show')
  async show(args: GitShowRequest): Promise<GitTextResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const commit = (typeof args.commit === 'string' && args.commit.trim()) ? args.commit.trim() : 'HEAD'
      const r = await execGitOk(this.ctx, ['-C', root, 'show', '--format=medium', commit], 'git show')
      return { ok: true, text: r.stdout.trim() ? cap(r.stdout, 200000, '建议用 stat=true 或 path 缩小范围') : '(无内容)' }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Diff one path (staged or working tree). */
  @Remote('diff')
  async diff(args: GitDiffRequest): Promise<GitTextResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const head = args.staged ? ['--cached'] : ['HEAD']
      const tail = (typeof args.path === 'string' && args.path.trim()) ? ['--', args.path.trim()] : []
      const r = await execGitOk(this.ctx, ['-C', root, 'diff', ...head, ...tail], 'git diff')
      return { ok: true, text: r.stdout.trim() ? cap(r.stdout, 200000, '建议用 stat 或 path 缩小范围') : '(无变更)' }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Recent log rows. */
  @Remote('log')
  async log(args: GitLogRequest): Promise<GitTextResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const n = Math.min(Math.max(1, Number(args.n) || 20), 100)
      const r = await execGitOk(this.ctx, ['-C', root, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', String(n)], 'git log')
      return { ok: true, text: r.stdout.trim() ? r.stdout : '(无提交记录)' }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Branch list/create/switch/delete. */
  @Remote('branch')
  async branch(args: GitBranchRequest): Promise<GitBranchListResult | GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const action = args.action ?? 'list'
      if (action === 'list') {
        const r = await execGitOk(this.ctx, ['-C', root, 'branch', '--format=%(refname:short)|%(HEAD)|%(upstream:short)'], 'git branch')
        return { ok: true, branches: await parseBranchText(r.stdout) }
      }
      const name = String(args.name ?? '').trim()
      if (!name) return { ok: false, error: '缺少 name' }
      if (action === 'create') {
        const argv = ['-C', root, 'branch']
        const from = (typeof args.from === 'string' && args.from.trim()) ? args.from.trim() : null
        if (from) argv.push(name, from)
        else argv.push(name)
        await execGitOk(this.ctx, argv, 'git branch')
        return { ok: true, message: `已创建分支 ${name}` }
      }
      if (action === 'switch') {
        const argv = ['-C', root, 'checkout']
        if (args.create) argv.push('-b')
        argv.push(name)
        await execGitOk(this.ctx, argv, 'git checkout')
        return { ok: true, message: `已切换到分支 ${name}` }
      }
      if (action === 'delete') {
        if (!(args.confirm === true)) return { ok: false, error: '删除分支需要确认（confirm=true）' }
        const flag = args.force ? '-D' : '-d'
        await execGitOk(this.ctx, ['-C', root, 'branch', flag, name], `git branch ${flag}`)
        return { ok: true, message: `已删除分支 ${name}` }
      }
      return { ok: false, error: `未知 action: ${action}` }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Checkout a branch. */
  @Remote('checkout')
  async checkout(args: GitCheckoutRequest): Promise<GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const target = String(args.target ?? '').trim()
      if (!target) return { ok: false, error: '缺少 target' }
      const argv = ['-C', root, 'checkout']
      if (args.create) argv.push('-b')
      if (args.force) {
        if (!(args.confirm === true)) return { ok: false, error: '强制切换需要确认（confirm=true）' }
        argv.push('-f')
      }
      argv.push(target)
      await execGitOk(this.ctx, argv, 'git checkout')
      return { ok: true, message: `已切换到分支 ${target}` }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Pull from a remote. */
  @Remote('pull')
  async pull(args: GitPullRequest): Promise<GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const argv = ['-C', root, 'pull']
      if (args.rebase) argv.push('--rebase')
      const remote = (typeof args.remote === 'string' && args.remote.trim()) ? args.remote.trim() : null
      const branch = (typeof args.branch === 'string' && args.branch.trim()) ? args.branch.trim() : null
      if (remote) argv.push(remote)
      if (branch) argv.push(branch)
      const r = await execGitOk(this.ctx, argv, 'git pull')
      return { ok: true, message: (r.stdout || r.stderr || '').trim() || 'pull 完成' }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Push to a remote. */
  @Remote('push')
  async push(args: GitPushRequest): Promise<GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      if (args.force && !(args.confirm === true)) return { ok: false, error: '强制推送需要确认（confirm=true）' }
      const argv = ['-C', root, 'push']
      if (args.setUpstream) argv.push('-u')
      if (args.force) argv.push('--force')
      const remote = (typeof args.remote === 'string' && args.remote.trim()) ? args.remote.trim() : null
      const branch = (typeof args.branch === 'string' && args.branch.trim()) ? args.branch.trim() : null
      if (remote) argv.push(remote)
      if (branch) argv.push(branch)
      const r = await execGitOk(this.ctx, argv, 'git push')
      return { ok: true, message: (r.stdout || r.stderr || '').trim() || '推送完成' }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Reset soft/mixed/hard. */
  @Remote('reset')
  async reset(args: GitResetRequest): Promise<GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const mode = args.mode ?? 'mixed'
      if (mode === 'hard' && !(args.confirm === true)) return { ok: false, error: 'reset --hard 需要确认（confirm=true）' }
      const argv = ['-C', root, 'reset']
      if (mode === 'soft') argv.push('--soft')
      else if (mode === 'hard') argv.push('--hard')
      else if (mode !== 'mixed') return { ok: false, error: `未知 mode: ${mode}` }
      argv.push((typeof args.target === 'string' && args.target.trim()) ? args.target.trim() : 'HEAD')
      await execGitOk(this.ctx, argv, 'git reset')
      return { ok: true, message: `已重置（mode=${mode}）` }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Clean untracked files (dry-run by default). */
  @Remote('clean')
  async clean(args: GitCleanRequest): Promise<GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const dry = !(args.dryRun === false)
      if (dry) {
        const r = await execGitOk(this.ctx, ['-C', root, 'clean', '-nd'], 'git clean -nd')
        return { ok: true, message: r.stdout.trim() ? `将删除:\n${r.stdout.trim()}` : '没有可清理的未跟踪文件' }
      }
      if (!(args.confirm === true)) return { ok: false, error: '清理需要确认（confirm=true）' }
      const r = await execGitOk(this.ctx, ['-C', root, 'clean', '-fd'], 'git clean -fd')
      return { ok: true, message: `已清理${r.stdout.trim() ? `:\n${r.stdout.trim()}` : ''}` }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Stash list/push/pop/apply/drop/clear. */
  @Remote('stash')
  async stash(args: GitStashRequest): Promise<GitActionResult> {
    try {
      const root = await repoRootOf(this.ctx, args.repoPath)
      const action = args.action ?? 'list'
      if (action === 'list') {
        const r = await execGitOk(this.ctx, ['-C', root, 'stash', 'list'], 'git stash list')
        return { ok: true, message: r.stdout.trim() ? r.stdout : '（无 stash）' }
      }
      if (action === 'push') {
        const argv = ['-C', root, 'stash', 'push']
        const msg = (typeof args.message === 'string' && args.message.trim()) ? args.message.trim() : ''
        if (msg) argv.push('-m', msg)
        const r = await execGitOk(this.ctx, argv, 'git stash push')
        return { ok: true, message: (r.stdout || r.stderr || '').trim() || '已暂存工作区' }
      }
      if (action === 'pop' || action === 'apply') {
        const r = await execGitOk(this.ctx, ['-C', root, 'stash', action], `git stash ${action}`)
        return { ok: true, message: (r.stdout || r.stderr || '').trim() || '完成' }
      }
      if (action === 'drop' || action === 'clear') {
        if (!(args.confirm === true)) return { ok: false, error: `${action} 需要确认（confirm=true）` }
        await execGitOk(this.ctx, ['-C', root, 'stash', action], `git stash ${action}`)
        return { ok: true, message: `已执行 git stash ${action}` }
      }
      return { ok: false, error: `未知 action: ${action}` }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Read the active plugin config for the settings page. */
  @Remote('getConfig')
  async getConfig(): Promise<GitConfigResult> {
    try {
      const cfg = await readConfig(this.ctx)
      return { ok: true, config: cfg }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Persist the settings page's config. */
  @Remote('setConfig')
  async setConfig(args: GitConfigPatch): Promise<GitActionResult> {
    try {
      await saveConfig(this.ctx, args)
      return { ok: true, message: '配置已保存' }
    } catch (error) {
      return { ok: false, error: String((error instanceof Error && error.message) || error) }
    }
  }
}

export const name = 'git'
export const inject = ['tools', 'settings', 'subprocess', 'llm']

/** Register the git tools, the Remote gateway, and the durable settings section. */
export function apply(ctx: Context): void {
  registerGitTools(ctx)
  new GitGateway(ctx)
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(GIT_SETTINGS_NAMESPACE, GitSettingsSchema)
  })
}
