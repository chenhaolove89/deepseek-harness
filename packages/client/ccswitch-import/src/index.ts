/**
 * CCSwitch provider import: AI tools (ccswitch_list / ccswitch_import /
 * visual_describe) plus the Remote gateway serving the settings-page import UI.
 * @module @deepseek-ai/dsh-ccswitch-import
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  CcswitchImportRequest,
  CcswitchImportResult,
  CcswitchImportRow,
  CcswitchListResult,
  CcswitchProviderItem,
} from './types.ts'

export type {
  CcswitchImportRequest,
  CcswitchImportResult,
  CcswitchImportRow,
  CcswitchListResult,
  CcswitchProviderItem,
} from './types.ts'

const READER = [
  "const os=require('node:os'),path=require('node:path'),fs=require('node:fs');",
  'let out;',
  'try{',
  "  const dbPath=path.join(os.homedir(),'.cc-switch','cc-switch.db');",
  "  if(!fs.existsSync(dbPath)){out={ok:false,error:'cc-switch 数据库不存在: '+dbPath};}",
  '  else{',
  "    const {DatabaseSync}=require('node:sqlite');",
  "    const db=new DatabaseSync(dbPath,{readOnly:true});",
  "    const rows=db.prepare('SELECT id, app_type, name, settings_config, meta FROM providers').all();",
  '    out={ok:true,dbPath,providers:rows.map(function(r){',
  '      let sc={},meta=null;',
  "      try{sc=JSON.parse(r.settings_config||'{}');}catch(e){}",
  '      try{meta=r.meta?JSON.parse(r.meta):null;}catch(e){}',
  '      return {id:r.id,appType:r.app_type,name:r.name,settingsConfig:sc,meta:meta};',
  '    })};',
  '  }',
  "}catch(e){out={ok:false,error:String((e&&e.message)||e)};}",
  'process.stdout.write(JSON.stringify(out));',
].join('\n')

interface CcswitchDbProvider {
  readonly id: string
  readonly appType: string
  readonly name: string
  readonly settingsConfig: Record<string, unknown>
  readonly meta: unknown
}

interface CcswitchProfile {
  readonly api: string
  readonly baseURL: string
  readonly key: string
  readonly models: string[]
}

function collectModels(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (typeof v === 'string' && v.trim() && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

function parseTomlText(text: unknown): { model?: string; baseUrl?: string; wireApi?: string } {
  if (typeof text !== 'string') return {}
  const out: { model?: string; baseUrl?: string; wireApi?: string } = {}
  const m = text.match(/^model\s*=\s*"([^"]+)"/m)
  if (m && m[1] !== undefined) out.model = m[1]
  const b = text.match(/^base_url\s*=\s*"([^"]+)"/m)
  if (b && b[1] !== undefined) out.baseUrl = b[1]
  const w = text.match(/^wire_api\s*=\s*"([^"]+)"/m)
  if (w && w[1] !== undefined) out.wireApi = w[1]
  return out
}

function profileOf(p: CcswitchDbProvider): CcswitchProfile | null {
  const sc = p.settingsConfig
  if (p.appType === 'claude' || p.appType === 'claude-desktop') {
    const env = (sc.env ?? {}) as Record<string, string | undefined>
    const models = collectModels([
      env.ANTHROPIC_MODEL,
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      env.ANTHROPIC_DEFAULT_FABLE_MODEL,
      env.ANTHROPIC_SMALL_FAST_MODEL,
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME,
      env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME,
      env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME,
    ])
    return {
      api: 'anthropic-messages',
      baseURL: env.ANTHROPIC_BASE_URL ?? '',
      key: env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY ?? '',
      models,
    }
  }
  if (p.appType === 'codex') {
    const auth = (sc.auth ?? {}) as Record<string, string | undefined>
    const cfg = parseTomlText(sc.config)
    const wire = cfg.wireApi === 'chat' || cfg.wireApi === 'completions' ? 'openai-completions' : 'openai-responses'
    const catalog = sc.modelCatalog as { models?: readonly { model?: string }[] } | undefined
    const listed = (catalog?.models ?? []).map(m => m.model).filter((m): m is string => typeof m === 'string')
    const models = collectModels([...listed, cfg.model])
    return { api: wire, baseURL: cfg.baseUrl ?? '', key: auth.OPENAI_API_KEY ?? '', models }
  }
  if (p.appType === 'gemini') {
    const env = (sc.env ?? {}) as Record<string, string | undefined>
    return {
      api: 'openai-completions',
      baseURL: env.GOOGLE_GEMINI_BASE_URL ?? '',
      key: env.GEMINI_API_KEY ?? '',
      models: collectModels([env.GEMINI_MODEL]),
    }
  }
  return null
}

function slugify(name: string): string {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return (s || 'provider').slice(0, 40)
}

async function readProviders(ctx: Context): Promise<{ dbPath: string; providers: readonly CcswitchDbProvider[] }> {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('subprocess 服务不可用')
  let node = 'node'
  try {
    node = await subprocess.resolveExecutable('node')
  } catch {
    // fall back to PATH lookup
  }
  const handle = subprocess.spawn({
    argv: [node, '-e', READER],
    cwd: '',
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 8 * 1024 * 1024 },
      stderr: { maxBytes: 128 * 1024 },
    },
    graceMs: 10000,
  })
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  if (outcome.exitCode !== 0) {
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    throw new Error('读取 cc-switch 数据库失败: ' + (stderr || stdout).slice(0, 400))
  }
  let parsed: { ok: boolean; dbPath?: string; providers?: readonly CcswitchDbProvider[]; error?: string }
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    throw new Error('cc-switch 读取器输出无法解析: ' + String((error instanceof Error && error.message) || error))
  }
  if (!parsed || !parsed.ok || !parsed.providers) {
    throw new Error(String(parsed?.error || 'cc-switch 读取失败'))
  }
  return { dbPath: parsed.dbPath ?? '', providers: parsed.providers }
}

function listSummary(
  ctx: Context,
  parsed: { dbPath: string; providers: readonly CcswitchDbProvider[] },
): { dbPath: string; providers: readonly CcswitchProviderItem[] } {
  const settings = ctx.get('settings')
  let existingProviders: Record<string, { displayName?: string }> = {}
  if (settings !== undefined) {
    const section = settings.get('llm-pi-ai' as SettingsNamespace) as { providers?: Record<string, { displayName?: string }> } | null | undefined
    if (section?.providers) existingProviders = section.providers
  }
  const importedNames = new Set<string>()
  for (const key of Object.keys(existingProviders)) {
    const prof = existingProviders[key]
    if (prof?.displayName) importedNames.add(String(prof.displayName))
  }
  const items: CcswitchProviderItem[] = parsed.providers.map(p => {
    const profile = profileOf(p)
    return {
      id: p.id,
      appType: p.appType,
      name: p.name,
      baseURL: profile ? profile.baseURL : '',
      modelCount: profile ? profile.models.length : 0,
      hasKey: !!(profile && profile.key),
      usable: !!(profile && profile.baseURL && profile.key && profile.models.length),
      imported: importedNames.has(p.name),
    }
  })
  return { dbPath: parsed.dbPath, providers: items }
}

async function runImport(
  ctx: Context,
  parsed: { providers: readonly CcswitchDbProvider[] },
  ids: readonly string[],
): Promise<readonly CcswitchImportRow[]> {
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  if (settings === undefined) throw new Error('settings 服务不可用')
  if (credentials === undefined) throw new Error('credentials 服务不可用')
  const byId = new Map(parsed.providers.map(p => [p.id, p]))
  const section = settings.get('llm-pi-ai' as SettingsNamespace) as { providers?: Record<string, { displayName?: string; apiKeyEnv?: string }> } | null | undefined
  const existingProviders = section?.providers ?? {}
  const usedRoutes = new Set(Object.keys(existingProviders))
  const usedRefs = new Set<string>()
  const results: CcswitchImportRow[] = []
  const patch: Record<string, unknown> = {}
  for (const id of ids) {
    const p = byId.get(id)
    if (!p) {
      results.push({ id, name: String(id), status: 'error', message: '在 CCSWITCH 中未找到该供应商' })
      continue
    }
    try {
      const profile = profileOf(p)
      if (!profile) {
        results.push({ id, name: p.name, status: 'error', message: '不支持的类型: ' + p.appType })
        continue
      }
      if (!profile.baseURL || !profile.key || !profile.models.length) {
        results.push({ id, name: p.name, status: 'error', message: '缺少 baseURL / 密钥 / 模型，无法导入' })
        continue
      }
      const base = 'ccswitch-' + slugify(p.name)
      let route = base
      if (usedRoutes.has(base) && existingProviders[base]) {
        route = base // re-import updates the same route in place
      } else {
        let i = 2
        while (usedRoutes.has(route)) route = base + '-' + (i++)
        usedRoutes.add(route)
      }
      const prior = existingProviders[route] ?? {}
      let ref = (typeof prior.apiKeyEnv === 'string' && prior.apiKeyEnv) || ('CCSWITCH_' + slugify(p.name).toUpperCase() + '_KEY')
      let k = 2
      while (usedRefs.has(ref)) ref = ref + '_' + (k++)
      usedRefs.add(ref)
      await credentials.set(ref as CredentialRef, profile.key)
      patch[route] = {
        displayName: p.name,
        apiKeyEnv: ref,
        api: profile.api,
        baseURL: profile.baseURL,
        models: profile.models.map(m => ({ id: m, name: m })),
      }
      results.push({ id, name: p.name, status: 'ok', route, updated: !!prior.displayName })
    } catch (error) {
      results.push({ id, name: p.name, status: 'error', message: String((error instanceof Error && error.message) || error) })
    }
  }
  if (Object.keys(patch).length > 0) {
    await settings.update('llm-pi-ai' as SettingsNamespace, { providers: patch })
  }
  return results
}

function mediaTypeOf(p: string): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
  const s = p.toLowerCase()
  if (s.endsWith('.png')) return 'image/png'
  if (s.endsWith('.jpg') || s.endsWith('.jpeg')) return 'image/jpeg'
  if (s.endsWith('.webp')) return 'image/webp'
  if (s.endsWith('.gif')) return 'image/gif'
  return null
}

async function resolveVisionRoute(ctx: Context): Promise<{ provider: string; model: string } | null> {
  const llm = ctx.get('llm')
  if (llm === undefined) return null
  const providers = llm.listProviders().map(p => p.id)
  try {
    const models = await llm.listModels('tokenrhythm')
    const qwen = models.find(m => m.id === 'qwen3.8-max')
    if (qwen && Array.isArray(qwen.inputModalities) && qwen.inputModalities.includes('image')) {
      return { provider: 'tokenrhythm', model: 'qwen3.8-max' }
    }
  } catch {
    // fall through to the provider sweep
  }
  for (const provider of providers) {
    let models: readonly { id: string; inputModalities?: readonly string[] }[] = []
    try {
      models = await llm.listModels(provider)
    } catch {
      continue
    }
    const vision = models.find(m => Array.isArray(m.inputModalities) && m.inputModalities.includes('image'))
    if (vision) return { provider, model: vision.id }
  }
  return null
}

async function streamVisionText(
  ctx: Context,
  route: { provider: string; model: string },
  ref: ImageAttachmentRef,
  question: string,
  signal: AbortSignal,
): Promise<string> {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('llm 服务不可用')
  let out = ''
  let reasoning = ''
  let finish: unknown = null
  let usage: unknown = null
  let chunkCount = 0
  const kinds: Record<string, number> = {}
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({
      content: [
        { type: 'text', text: question },
        { type: 'image', attachment: ref },
      ],
      source: { kind: 'user' },
    })],
    signal,
    maxTokens: 8192,
  })) {
    chunkCount++
    kinds[chunk.type] = (kinds[chunk.type] ?? 0) + 1
    if (chunk.type === 'text-delta') out += chunk.text
    else if (chunk.type === 'reasoning-delta') reasoning += chunk.text
    else if (chunk.type === 'block-end' && chunk.block.type === 'text') out += chunk.block.text
    else if (chunk.type === 'block-end' && chunk.block.type === 'reasoning') reasoning += chunk.block.text
    else if (chunk.type === 'usage') usage = chunk.usage
    else if (chunk.type === 'finish') finish = chunk
  }
  const finishReason = (finish as { reason?: { kind?: string; failure?: { message?: string; code?: string } } } | null)?.reason
  if (finishReason?.kind === 'error') {
    const f = finishReason.failure
    throw new Error('视觉模型调用失败: ' + String((f && (f.message || f.code)) || '未知错误'))
  }
  const trimmed = out.trim()
  if (trimmed) return trimmed
  const reasonTrimmed = reasoning.trim()
  if (reasonTrimmed) return '（视觉模型返回的是思考内容）\n' + reasonTrimmed
  const finishText = finishReason ? JSON.stringify(finishReason) : String(finish ?? '无 finish')
  const usageText = usage ? ', usage=' + JSON.stringify(usage) : ''
  throw new Error('视觉模型未返回内容 (chunks=' + chunkCount + ', kinds=' + JSON.stringify(kinds) + ', finish=' + finishText + usageText + ')')
}

async function describeImage(ctx: Context, path: string, question: string, provider?: string, model?: string, signal?: AbortSignal): Promise<string> {
  const llm = ctx.get('llm')
  const fs = ctx.get('fs')
  const attachments = ctx.get('attachments')
  if (llm === undefined) throw new Error('llm 服务不可用')
  if (fs === undefined) throw new Error('fs 服务不可用')
  if (attachments === undefined) throw new Error('attachments 服务不可用')
  let route: { provider: string; model: string } | null = null
  if (provider && model) {
    route = { provider, model }
  } else {
    route = await resolveVisionRoute(ctx)
  }
  if (route === null) {
    throw new Error('未找到可用的视觉模型：请用 provider/model 参数指定，或在「模型」设置中添加支持视觉的供应商')
  }
  const mediaType = mediaTypeOf(path)
  if (!mediaType) throw new Error('不支持的图片格式（支持 png/jpeg/webp/gif）')
  const target = await fs.resolve(path)
  const limits = attachments.imageLimits
  const maxBytes = limits?.maxImageBytes ?? 20 * 1024 * 1024
  const data = await fs.readBytes(target, signal, maxBytes + 1)
  if (data.byteLength > maxBytes) throw new Error('图片超过大小限制（' + maxBytes + ' 字节）')
  const fileName = path.split(/[\\/]/).pop()
  const ref = await attachments.saveImage({
    data,
    mediaType,
    ...(fileName !== undefined ? { name: fileName } : {}),
  })
  const text = await streamVisionText(ctx, route, ref, question, signal ?? new AbortController().signal)
  return '视觉模型 [' + route.provider + '/' + route.model + '] 的描述：\n' + text
}

/** Remote gateway serving the settings-page import UI. */
export class CcswitchGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'ccswitch')
  }

  /** List CCSWITCH providers with importability summaries. */
  @Remote('list')
  async list(): Promise<CcswitchListResult> {
    try {
      const parsed = await readProviders(this.ctx)
      const summary = listSummary(this.ctx, parsed)
      return { ok: true, dbPath: summary.dbPath, providers: summary.providers }
    } catch (error) {
      return { ok: false, dbPath: '', providers: [], error: String((error instanceof Error && error.message) || error) }
    }
  }

  /** Batch-import the selected CCSWITCH provider ids. */
  @Remote('import')
  async import(args: CcswitchImportRequest): Promise<CcswitchImportResult> {
    const ids = Array.isArray(args?.ids) ? args.ids.map(String) : []
    try {
      const parsed = await readProviders(this.ctx)
      const results = await runImport(this.ctx, parsed, ids)
      return { ok: true, results }
    } catch (error) {
      return { ok: false, results: [], error: String((error instanceof Error && error.message) || error) }
    }
  }
}

export const name = 'ccswitch-import'
export const inject = ['tools', 'settings', 'credentials', 'subprocess', 'llm', 'fs', 'attachments']

/** Register the AI tools and the Remote gateway. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'ccswitch_list',
    description:
      '列出 CCSWITCH（~/.cc-switch）中保存的所有模型供应商：id、名称、类型（claude/codex 等）、地址、模型数、是否可导入。'
      + '结果中的 id 可传给 ccswitch_import 批量导入。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      const parsed = await readProviders(ctx)
      const summary = listSummary(ctx, parsed)
      const lines = summary.providers.map(it =>
        (it.usable ? '' : '[不可用] ') + it.id + ' | ' + it.name + ' | ' + it.appType + ' | ' + (it.baseURL || '(无地址)')
        + ' | ' + it.modelCount + ' 个模型' + (it.imported ? ' | 已导入' : ''))
      return 'CCSWITCH 供应商列表（id | 名称 | 类型 | 地址 | 模型数）：\n' + (lines.length ? lines.join('\n') : '(空)')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'ccswitch_import',
    description:
      '将 CCSWITCH 中的供应商批量导入为 DeepSeek Harness 的模型供应商（写入 llm-pi-ai 设置与凭据）。'
      + 'ids 使用 ccswitch_list 返回的供应商 id。导入后模型选择器立即可用。',
    parameters: {
      ids: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: '要导入的 CCSWITCH 供应商 id 列表',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const ids = Array.isArray(args?.ids) ? args.ids.map(String) : []
      if (ids.length === 0) throw new Error('ids 不能为空')
      const parsed = await readProviders(ctx)
      const results = await runImport(ctx, parsed, ids)
      const ok = results.filter(r => r.status === 'ok')
      const fail = results.filter(r => r.status !== 'ok')
      const lines = ok.map(r => '已导入 ' + r.name + ' → ' + r.route)
        .concat(fail.map(r => '失败 ' + r.name + ': ' + (r.message ?? '')))
      return '导入完成：成功 ' + ok.length + ' 项，失败 ' + fail.length + ' 项。\n' + (lines.length ? lines.join('\n') : '')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'visual_describe',
    description:
      '让视觉模型描述图片内容：给定图片文件路径（和可选问题），将图片交给支持视觉的模型理解并返回文字描述。'
      + '当当前模型不支持图片输入时，用它来「看图」。默认使用 tokenrhythm/qwen3.8-max；可用 provider/model 参数指定其他支持视觉的模型。',
    parameters: {
      path: { type: 'string', required: true, description: '图片文件的绝对路径（png/jpeg/webp/gif）' },
      question: { type: 'string', description: '针对图片的问题或指令，默认要求详细描述图片内容' },
      provider: { type: 'string', description: '视觉模型所在供应商路由，默认 tokenrhythm' },
      model: { type: 'string', description: '视觉模型 id，默认 qwen3.8-max' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const path = String(args?.path ?? '').trim()
      if (!path) throw new Error('缺少 path 参数')
      const question = (typeof args.question === 'string' && args.question.trim())
        ? args.question.trim()
        : '请详细描述这张图片的内容。'
      return describeImage(ctx, path, question, args.provider, args.model, exec.signal)
    },
  }))

  new CcswitchGateway(ctx)
}
