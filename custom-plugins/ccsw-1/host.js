return {
  apply(ctx) {
    const READER = `const os=require('node:os'),path=require('node:path'),fs=require('node:fs');
let out;
try{
  const dbPath=path.join(os.homedir(),'.cc-switch','cc-switch.db');
  if(!fs.existsSync(dbPath)){out={ok:false,error:'cc-switch 数据库不存在: '+dbPath};}
  else{
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(dbPath,{readOnly:true});
    const rows=db.prepare('SELECT id, app_type, name, settings_config, meta FROM providers').all();
    out={ok:true,dbPath,providers:rows.map(function(r){
      let sc={},meta=null;
      try{sc=JSON.parse(r.settings_config||'{}');}catch(e){}
      try{meta=r.meta?JSON.parse(r.meta):null;}catch(e){}
      return {id:r.id,appType:r.app_type,name:r.name,settingsConfig:sc,meta:meta};
    })};
  }
}catch(e){out={ok:false,error:String((e&&e.message)||e)};}
process.stdout.write(JSON.stringify(out));`

    function collectModels(values) {
      const seen = new Set()
      const out = []
      for (const v of values) {
        if (typeof v === 'string' && v.trim() && !seen.has(v)) { seen.add(v); out.push(v) }
      }
      return out
    }

    function parseTomlText(text) {
      const out = {}
      if (typeof text !== 'string') return out
      const m = text.match(/^model\s*=\s*"([^"]+)"/m); if (m) out.model = m[1]
      const b = text.match(/^base_url\s*=\s*"([^"]+)"/m); if (b) out.baseUrl = b[1]
      const w = text.match(/^wire_api\s*=\s*"([^"]+)"/m); if (w) out.wireApi = w[1]
      return out
    }

    function profileOf(p) {
      const sc = p.settingsConfig || {}
      if (p.appType === 'claude' || p.appType === 'claude-desktop') {
        const env = sc.env || {}
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
          baseURL: env.ANTHROPIC_BASE_URL || '',
          key: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '',
          models,
        }
      }
      if (p.appType === 'codex') {
        const auth = sc.auth || {}
        const cfg = parseTomlText(sc.config)
        const wire = cfg.wireApi === 'chat' || cfg.wireApi === 'completions' ? 'openai-completions' : 'openai-responses'
        const listed = (sc.modelCatalog && sc.modelCatalog.models || []).map(function (m) { return m.model }).filter(Boolean)
        const models = collectModels(listed.concat(cfg.model))
        return { api: wire, baseURL: cfg.baseUrl || '', key: auth.OPENAI_API_KEY || '', models }
      }
      if (p.appType === 'gemini') {
        const env = sc.env || {}
        return {
          api: 'openai-completions',
          baseURL: env.GOOGLE_GEMINI_BASE_URL || '',
          key: env.GEMINI_API_KEY || '',
          models: collectModels([env.GEMINI_MODEL]),
        }
      }
      return null
    }

    function slugify(name) {
      const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      return (s || 'provider').slice(0, 40)
    }

    async function readProviders() {
      const subprocess = ctx.get('subprocess')
      if (subprocess === undefined) throw new Error('subprocess 服务不可用')
      let node = 'node'
      try { node = await subprocess.resolveExecutable('node') } catch (e) { /* fall back to PATH lookup */ }
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
      const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
      if (outcome.exitCode !== 0) {
        const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
        throw new Error('读取 cc-switch 数据库失败: ' + (stderr || stdout).slice(0, 400))
      }
      let parsed
      try { parsed = JSON.parse(stdout) } catch (e) { throw new Error('cc-switch 读取器输出无法解析: ' + String((e && e.message) || e)) }
      if (!parsed || !parsed.ok) throw new Error(String((parsed && parsed.error) || 'cc-switch 读取失败'))
      return parsed
    }

    function listSummary(parsed) {
      const settings = ctx.get('settings')
      let existingProviders = {}
      if (settings !== undefined) {
        const section = settings.get('llm-pi-ai')
        if (section && section.providers) existingProviders = section.providers
      }
      const importedNames = new Set()
      for (const key of Object.keys(existingProviders)) {
        const prof = existingProviders[key]
        if (prof && prof.displayName) importedNames.add(String(prof.displayName))
      }
      const items = []
      for (const p of parsed.providers) {
        const profile = profileOf(p)
        items.push({
          id: p.id,
          appType: p.appType,
          name: p.name,
          baseURL: profile ? profile.baseURL : '',
          modelCount: profile ? profile.models.length : 0,
          hasKey: !!(profile && profile.key),
          usable: !!(profile && profile.baseURL && profile.key && profile.models.length),
          imported: importedNames.has(p.name),
        })
      }
      return { items: items, dbPath: parsed.dbPath }
    }

    async function runImport(settings, credentials, parsed, ids, hostProto) {
      const hostify = function (value) {
        if (value === null || typeof value !== 'object') return value
        if (Array.isArray(value)) return value.map(hostify)
        const out = Object.create(hostProto)
        for (const key of Object.keys(value)) out[key] = hostify(value[key])
        return out
      }
      const byId = new Map(parsed.providers.map(function (p) { return [p.id, p] }))
      const section = settings.get('llm-pi-ai')
      const existingProviders = (section && section.providers) || {}
      const usedRoutes = new Set(Object.keys(existingProviders))
      const usedRefs = new Set()
      const results = []
      const patch = hostify({})
      for (const id of ids) {
        const p = byId.get(id)
        if (!p) { results.push({ id: id, name: String(id), status: 'error', message: '在 CCSWITCH 中未找到该供应商' }); continue }
        try {
          const profile = profileOf(p)
          if (!profile) { results.push({ id: id, name: p.name, status: 'error', message: '不支持的类型: ' + p.appType }); continue }
          if (!profile.baseURL || !profile.key || !profile.models.length) {
            results.push({ id: id, name: p.name, status: 'error', message: '缺少 baseURL / 密钥 / 模型，无法导入' })
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
          const prior = existingProviders[route] || {}
          let ref = (typeof prior.apiKeyEnv === 'string' && prior.apiKeyEnv) || ('CCSWITCH_' + slugify(p.name).toUpperCase() + '_KEY')
          let k = 2
          while (usedRefs.has(ref)) ref = ref + '_' + (k++)
          usedRefs.add(ref)
          await credentials.set(ref, profile.key)
          patch[route] = hostify({
            displayName: p.name,
            apiKeyEnv: ref,
            api: profile.api,
            baseURL: profile.baseURL,
            models: profile.models.map(function (m) { return { id: m, name: m } }),
          })
          results.push({ id: id, name: p.name, status: 'ok', route: route, updated: !!prior.displayName })
        } catch (e) {
          results.push({ id: id, name: p.name, status: 'error', message: String((e && e.message) || e) })
        }
      }
      if (Object.keys(patch).length > 0) {
        await settings.update('llm-pi-ai', hostify({ providers: patch }))
      }
      return results
    }

    harness.handle('ccswitch.list', async () => {
      const parsed = await readProviders()
      const summary = listSummary(parsed)
      return { ok: true, dbPath: summary.dbPath, providers: summary.items }
    })

    harness.handle('ccswitch.import', async (args) => {
      const ids = Array.isArray(args && args.ids) ? args.ids.map(String) : []
      const settings = ctx.get('settings')
      const credentials = ctx.get('credentials')
      if (settings === undefined) throw new Error('settings 服务不可用')
      if (credentials === undefined) throw new Error('credentials 服务不可用')
      const parsed = await readProviders()
      const results = await runImport(settings, credentials, parsed, ids, Object.getPrototypeOf(args))
      return { ok: true, results: results }
    })

    function mediaTypeOf(p) {
      const s = String(p).toLowerCase()
      if (s.endsWith('.png')) return 'image/png'
      if (s.endsWith('.jpg') || s.endsWith('.jpeg')) return 'image/jpeg'
      if (s.endsWith('.webp')) return 'image/webp'
      if (s.endsWith('.gif')) return 'image/gif'
      return null
    }

    async function resolveVisionRoute(llm) {
      const providers = llm.listProviders().map(function (p) { return p.id })
      try {
        const models = await llm.listModels('tokenrhythm')
        const qwen = models.find(function (m) { return m.id === 'qwen3.8-max' })
        if (qwen && Array.isArray(qwen.inputModalities) && qwen.inputModalities.indexOf('image') !== -1) {
          return { provider: 'tokenrhythm', model: 'qwen3.8-max' }
        }
      } catch (e) { /* fall through */ }
      for (const provider of providers) {
        let models = []
        try { models = await llm.listModels(provider) } catch (e) { continue }
        const vision = models.find(function (m) { return Array.isArray(m.inputModalities) && m.inputModalities.indexOf('image') !== -1 })
        if (vision) return { provider: provider, model: vision.id }
      }
      return null
    }

    async function streamVisionText(llm, route, ref, question, signal) {
      const message = {
        id: 'vis-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image', attachment: ref },
        ],
        source: { kind: 'user' },
      }
      let out = ''
      let reasoning = ''
      let finish = null
      let usage = null
      let chunkCount = 0
      const kinds = {}
      for await (const chunk of llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [message],
        signal: signal,
        maxTokens: 8192,
      })) {
        chunkCount++
        kinds[chunk.type] = (kinds[chunk.type] || 0) + 1
        if (chunk.type === 'text-delta') out += chunk.text
        else if (chunk.type === 'reasoning-delta') reasoning += chunk.text
        else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') out += chunk.block.text
        else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'reasoning') reasoning += chunk.block.text
        else if (chunk.type === 'usage') usage = chunk.usage
        else if (chunk.type === 'finish') finish = chunk
      }
      if (finish && finish.reason && finish.reason.kind === 'error') {
        const f = finish.reason.failure
        throw new Error('视觉模型调用失败: ' + String((f && (f.message || f.code)) || '未知错误'))
      }
      const trimmed = out.trim()
      if (trimmed) return trimmed
      const reasonTrimmed = reasoning.trim()
      if (reasonTrimmed) return '（视觉模型返回的是思考内容）\n' + reasonTrimmed
      const finishText = finish && finish.reason ? JSON.stringify(finish.reason) : String(finish || '无 finish')
      const usageText = usage ? ', usage=' + JSON.stringify(usage) : ''
      throw new Error('视觉模型未返回内容 (chunks=' + chunkCount + ', kinds=' + JSON.stringify(kinds) + ', finish=' + finishText + usageText + ')')
    }

    const registerTool = function (definition) {
      return harness.registerTool(ctx, harness.defineTool(definition))
    }

    registerTool({
      name: 'ccswitch_list',
      description: '列出 CCSWITCH（~/.cc-switch）中保存的所有模型供应商：id、名称、类型（claude/codex 等）、地址、模型数、是否可导入。结果中的 id 可传给 ccswitch_import 批量导入。',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: function (_args, value) { return [{ type: 'text', text: String(value) }] },
      },
      async execute() {
        const parsed = await readProviders()
        const summary = listSummary(parsed)
        const lines = summary.items.map(function (it) {
          return (it.usable ? '' : '[不可用] ') + it.id + ' | ' + it.name + ' | ' + it.appType + ' | ' + (it.baseURL || '(无地址)') + ' | ' + it.modelCount + ' 个模型' + (it.imported ? ' | 已导入' : '')
        })
        return 'CCSWITCH 供应商列表（id | 名称 | 类型 | 地址 | 模型数）：\n' + (lines.length ? lines.join('\n') : '(空)')
      },
    })

    registerTool({
      name: 'ccswitch_import',
      description: '将 CCSWITCH 中的供应商批量导入为 DeepSeek Harness 的模型供应商（写入 llm-pi-ai 设置与凭据）。ids 使用 ccswitch_list 返回的供应商 id。导入后模型选择器立即可用。',
      parameters: {
        ids: { type: 'array', items: { type: 'string' }, required: true, description: '要导入的 CCSWITCH 供应商 id 列表' },
      },
      output: {
        schema: { type: 'string' },
        render: function (_args, value) { return [{ type: 'text', text: String(value) }] },
      },
      async execute(args) {
        const ids = Array.isArray(args && args.ids) ? args.ids.map(String) : []
        const settings = ctx.get('settings')
        const credentials = ctx.get('credentials')
        if (settings === undefined) throw new Error('settings 服务不可用')
        if (credentials === undefined) throw new Error('credentials 服务不可用')
        if (ids.length === 0) throw new Error('ids 不能为空')
        const parsed = await readProviders()
        const results = await runImport(settings, credentials, parsed, ids, Object.getPrototypeOf(args))
        const ok = results.filter(function (r) { return r.status === 'ok' })
        const fail = results.filter(function (r) { return r.status !== 'ok' })
        const lines = ok.map(function (r) { return '已导入 ' + r.name + ' → ' + r.route })
          .concat(fail.map(function (r) { return '失败 ' + r.name + ': ' + r.message }))
        return '导入完成：成功 ' + ok.length + ' 项，失败 ' + fail.length + ' 项。\n' + (lines.length ? lines.join('\n') : '')
      },
    })

    registerTool({
      name: 'visual_describe',
      description: '让视觉模型描述图片内容：给定图片文件路径（和可选问题），将图片交给支持视觉的模型理解并返回文字描述。当当前模型不支持图片输入时，用它来「看图」。默认使用 tokenrhythm/qwen3.8-max；可用 provider/model 参数指定其他支持视觉的模型。',
      parameters: {
        path: { type: 'string', required: true, description: '图片文件的绝对路径（png/jpeg/webp/gif）' },
        question: { type: 'string', description: '针对图片的问题或指令，默认要求详细描述图片内容' },
        provider: { type: 'string', description: '视觉模型所在供应商路由，默认 tokenrhythm' },
        model: { type: 'string', description: '视觉模型 id，默认 qwen3.8-max' },
      },
      output: {
        schema: { type: 'string' },
        render: function (_args, value) { return [{ type: 'text', text: String(value) }] },
      },
      async execute(args, exec) {
        const llm = ctx.get('llm')
        const fs = ctx.get('fs')
        const attachments = ctx.get('attachments')
        if (llm === undefined) throw new Error('llm 服务不可用')
        if (fs === undefined) throw new Error('fs 服务不可用')
        if (attachments === undefined) throw new Error('attachments 服务不可用')
        const path = String(args && args.path || '').trim()
        if (!path) throw new Error('缺少 path 参数')
        const question = (typeof args.question === 'string' && args.question.trim()) ? args.question.trim() : '请详细描述这张图片的内容。'
        let route = null
        if (typeof args.provider === 'string' && args.provider && typeof args.model === 'string' && args.model) {
          route = { provider: args.provider, model: args.model }
        } else {
          route = await resolveVisionRoute(llm)
        }
        if (route === null) {
          throw new Error('未找到可用的视觉模型：请用 provider/model 参数指定，或在「模型」设置中添加支持视觉的供应商')
        }
        const mediaType = mediaTypeOf(path)
        if (!mediaType) throw new Error('不支持的图片格式（支持 png/jpeg/webp/gif）')
        const target = await fs.resolve(path)
        const limits = attachments.imageLimits
        const maxBytes = limits && limits.maxImageBytes ? limits.maxImageBytes : 20 * 1024 * 1024
        const data = await fs.readBytes(target, exec.signal, maxBytes + 1)
        if (data.byteLength > maxBytes) throw new Error('图片超过大小限制（' + maxBytes + ' 字节）')
        const ref = await attachments.saveImage({ data: data, mediaType: mediaType, name: path.split(/[\\\/]/).pop() })
        const text = await streamVisionText(llm, route, ref, question, exec.signal)
        return '视觉模型 [' + route.provider + '/' + route.model + '] 的描述：\n' + text
      },
    })
  },
}
