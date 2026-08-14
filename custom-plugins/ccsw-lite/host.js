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
  },
}
