// godot-ctrl — 通过 Godot AI（godot_ai）MCP 服务器控制 Godot 编辑器/游戏。
// 本文件 = cordis_define 的 code.host 原文。纯 JavaScript：无 import/require/TS/JSX。
// 依赖 DSH Host 能力：subprocess（curl 发起 MCP streamable-HTTP）、fs（截图落盘）、
// harness（动态模型工具注册）。目标服务器默认 http://127.0.0.1:8000/mcp。

return {
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    const fsService = ctx.get('fs')
    if (subprocess === undefined) {
      console.log('[godot-ctrl] subprocess 服务不可用，插件未激活')
      return
    }

    const state = {
      baseUrl: 'http://127.0.0.1:8000/mcp',
      sessionId: '',
      serverInfo: null,
      protocolVersion: '2025-06-18',
      initPromise: null,
      seq: 1,
    }

    let curlPath = null
    let certutilPath = null
    let cwdCache = null

    async function resolveCurl() {
      if (curlPath) return curlPath
      try { curlPath = await subprocess.resolveExecutable('curl') } catch (e) { curlPath = 'C:\\Windows\\System32\\curl.exe' }
      return curlPath
    }

    async function resolveCertutil() {
      if (certutilPath) return certutilPath
      try { certutilPath = await subprocess.resolveExecutable('certutil') } catch (e) { certutilPath = 'C:\\Windows\\System32\\certutil.exe' }
      return certutilPath
    }

    async function defaultCwd() {
      if (cwdCache) return cwdCache
      try {
        if (fsService) {
          const target = await fsService.resolve('.')
          cwdCache = fsService.processPath(target)
        }
      } catch (e) { /* keep fallback */ }
      if (!cwdCache) cwdCache = 'C:\\'
      return cwdCache
    }

    // 一次 MCP streamable-HTTP POST（curl 子进程，stdin 传 JSON body，-i 带回响应头）。
    async function curlPost(body, options) {
      const opts = options || {}
      const timeoutMs = opts.timeoutMs || 30000
      const sessionId = opts.sessionId || ''
      const curl = await resolveCurl()
      const argv = [
        curl, '-sS', '-m', String(Math.ceil(timeoutMs / 1000)), '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-H', 'Accept: application/json, text/event-stream',
        '-H', 'Expect:',
      ]
      if (sessionId) argv.push('-H', 'Mcp-Session-Id: ' + sessionId)
      argv.push('-i', '--data-binary', '@-', state.baseUrl)
      let handle
      try {
        handle = subprocess.spawn({
          argv: argv,
          cwd: await defaultCwd(),
          stdio: {
            stdin: { data: body },
            stdout: { maxBytes: 16 * 1024 * 1024, spill: { maxBytes: 128 * 1024 * 1024 } },
            stderr: { maxBytes: 1024 * 1024 },
          },
          graceMs: 2000,
          signal: opts.signal,
        })
      } catch (e) {
        return { error: { code: 'SPAWN', message: '启动 curl 失败: ' + ((e && e.message) || String(e)) } }
      }
      let outcome
      try { outcome = await handle.done } catch (e) {
        return { error: { code: 'SPAWN', message: 'curl 进程异常: ' + ((e && e.message) || String(e)) } }
      }
      const outText = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
      const errText = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
      if (outcome.exitCode !== 0) {
        let code = 'CURL_ERROR'
        let message = 'curl 退出码 ' + String(outcome.exitCode) + (errText ? '：' + errText.slice(0, 300) : '')
        if (outcome.exitCode === 7) {
          code = 'GODOT_UNREACHABLE'
          message = '无法连接 Godot MCP 服务器（' + state.baseUrl + '）。请确认 Godot 编辑器已启动、godot_ai 插件已启用。'
        }
        if (outcome.exitCode === 28) {
          code = 'TIMEOUT'
          message = '请求超时（' + timeoutMs + 'ms）'
        }
        return { error: { code: code, message: message } }
      }
      const last = outText.lastIndexOf('\r\n\r\n')
      const headers = last >= 0 ? outText.slice(0, last) : outText
      const bodyText = last >= 0 ? outText.slice(last + 4) : ''
      const m = /^mcp-session-id:\s*(.+)$/im.exec(headers)
      const statusMatch = /^HTTP\/\S+\s+(\d+)/m.exec(headers)
      const status = statusMatch ? Number(statusMatch[1]) : 0
      if (status >= 400) {
        return { error: { code: 'HTTP_' + status, message: 'MCP 服务器返回 HTTP ' + status + '：' + bodyText.slice(0, 300) } }
      }
      return { status: status, body: bodyText, sessionId: m ? m[1].trim() : '' }
    }

    // MCP 响应体可能是纯 JSON，也可能是 SSE（data: 行）。
    function parseMcpBody(raw) {
      const text = String(raw || '')
      const trimmed = text.trim()
      if (!trimmed) return null
      if (trimmed.startsWith('{')) {
        try { return JSON.parse(trimmed) } catch (e) { /* fall through to SSE */ }
      }
      const dataLines = []
      text.split(/\r?\n/).forEach(function (line) {
        if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim())
      })
      if (dataLines.length > 0) {
        try { return JSON.parse(dataLines.join('\n')) } catch (e) { /* not parseable */ }
      }
      return null
    }

    // MCP initialize 握手（懒加载，成功后缓存 session id；连接丢失自动重建）。
    function ensureInit() {
      if (state.initPromise) return state.initPromise
      state.initPromise = (async () => {
        const body = JSON.stringify({
          jsonrpc: '2.0',
          id: state.seq++,
          method: 'initialize',
          params: {
            protocolVersion: state.protocolVersion,
            capabilities: {},
            clientInfo: { name: 'dsh-godot-ctrl', version: '1.0.0' },
          },
        })
        const res = await curlPost(body, { timeoutMs: 15000 })
        if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code })
        if (res.sessionId) state.sessionId = res.sessionId
        const msg = parseMcpBody(res.body)
        if (!msg) throw new Error('MCP initialize 无响应')
        if (msg.error) throw Object.assign(new Error('MCP initialize 错误: ' + (msg.error.message || 'unknown')), { code: 'MCP_INIT' })
        const info = msg.result && msg.result.serverInfo
        state.serverInfo = info ? { name: info.name, version: info.version, protocolVersion: msg.result.protocolVersion } : null
        try {
          curlPost(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), { timeoutMs: 5000, sessionId: state.sessionId || '' }).catch(function () {})
        } catch (e) { /* fire-and-forget */ }
        return true
      })().finally(function () { state.initPromise = null })
      return state.initPromise
    }

    async function mcpRequest(method, params, options) {
      const opts = options || {}
      await ensureInit()
      const body = JSON.stringify({ jsonrpc: '2.0', id: state.seq++, method: method, params: params || {} })
      const res = await curlPost(body, { timeoutMs: opts.timeoutMs || 60000, sessionId: state.sessionId || '', signal: opts.signal })
      if (res.error) {
        if (res.error.code === 'GODOT_UNREACHABLE' || res.error.code === 'HTTP_404' || res.error.code === 'HTTP_400') state.sessionId = ''
        return { ok: false, error: res.error }
      }
      if (res.sessionId) state.sessionId = res.sessionId
      const msg = parseMcpBody(res.body)
      if (!msg) return { ok: false, error: { code: 'BAD_RESPONSE', message: '无法解析 MCP 响应', raw: String(res.body).slice(0, 300) } }
      if (msg.error) return { ok: false, error: msg.error }
      return { ok: true, result: msg.result === undefined ? null : msg.result }
    }

    // 调用服务器工具；连接中断时自动重新握手一次。
    async function callTool(name, args, options) {
      const opts = options || {}
      const timeoutMs = opts.timeoutMs || 60000
      try {
        await ensureInit()
      } catch (e) {
        return {
          ok: false,
          error: {
            code: (e && e.code) || 'GODOT_UNREACHABLE',
            message: ((e && e.message) || String(e)) + '。请确认 Godot 编辑器已启动、godot_ai 插件已启用、MCP 服务监听 ' + state.baseUrl,
          },
          hint: '可先调用 godot_status 检查连接',
        }
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = await mcpRequest('tools/call', { name: name, arguments: args || {} }, { timeoutMs: timeoutMs, signal: opts.signal })
        if (res.ok) {
          const r = res.result || {}
          const content = Array.isArray(r.content) ? r.content : []
          const text = content.filter(function (c) { return c && c.type === 'text' }).map(function (c) { return c.text }).join('\n')
          const images = content.filter(function (c) { return c && c.type === 'image' })
          let data = null
          if (r.structuredContent !== undefined && r.structuredContent !== null) {
            data = r.structuredContent
          } else if (text) {
            try { data = JSON.parse(text) } catch (e) { data = text }
          } else if (images.length > 0) {
            data = { images: images.map(function (i) { return { mimeType: i.mimeType || 'image/png', dataLength: String(i.data || '').length } }) }
          } else {
            data = { raw: r }
          }
          const out = { ok: !r.isError, data: data, isError: !!r.isError, tool: name }
          if (opts.raw) { out.content = content; out.rawResult = r }
          return out
        }
        const code = res.error && res.error.code
        if ((code === 'GODOT_UNREACHABLE' || code === 'HTTP_404' || code === 'HTTP_400') && attempt === 0) {
          state.sessionId = ''
          try { await ensureInit() } catch (e) { /* report below */ }
          continue
        }
        return { ok: false, error: res.error, tool: name }
      }
      return { ok: false, error: { code: 'RETRY_FAILED', message: '重试后仍失败' }, tool: name }
    }

    function withSession(args) {
      if (!state.sessionId) return args
      const copy = {}
      Object.keys(args).forEach(function (k) { copy[k] = args[k] })
      copy.session_id = state.sessionId
      return copy
    }

    // 必须用 harness.defineTool 构造（marker 校验），harness.registerTool 只接受它的产物。
    function makeTool(name, description, properties, required, run) {
      return harness.defineTool({
        name: name,
        description: description,
        parameters: {
          type: 'object',
          properties: properties,
          required: required || [],
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: function (args, value) {
            return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
          },
        },
        async execute(args, exec) {
          try {
            return await run(args, exec)
          } catch (e) {
            return { ok: false, error: { code: 'INTERNAL', message: ((e && e.message) || String(e)) } }
          }
        },
      })
    }

    // 截图：MCP 返回 base64 图片 → fs 写 .b64 → certutil 解码为 .png，返回落盘路径。
    async function saveBase64Png(base64data, outDir) {
      const dir = outDir || 'godot_shots'
      const ts = Date.now()
      const b64Name = 'godot_' + ts + '.b64'
      const pngName = 'godot_' + ts + '.png'
      const b64Target = await fsService.resolve(dir + '/' + b64Name)
      const pngTarget = await fsService.resolve(dir + '/' + pngName)
      const b64Path = fsService.processPath(b64Target)
      const pngPath = fsService.processPath(pngTarget)
      await fsService.writeText(b64Target, base64data)
      const certutil = await resolveCertutil()
      const h = subprocess.spawn({
        argv: [certutil, '-decode', b64Path, pngPath],
        cwd: await defaultCwd(),
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 1024 * 1024 } },
        graceMs: 2000,
      })
      const out = await h.done
      if (out.exitCode !== 0) {
        const errText = h.collected.stderr ? h.collected.stderr.readFrom(0).text : ''
        throw new Error('certutil 解码失败（exit ' + String(out.exitCode) + '）' + (errText ? '：' + errText.slice(0, 200) : ''))
      }
      return pngPath
    }

    const tools = []

    tools.push(makeTool(
      'godot_status',
      '检查与 Godot 编辑器的 MCP 连接并读取编辑器状态（版本、项目名、当前场景、readiness、是否正在运行游戏）。控制 Godot 前建议先调用。返回 server 信息、session_id 与 editor_state。',
      {}, [],
      async function (args, exec) {
        const r = await callTool('editor_state', withSession({}), { timeoutMs: 30000, signal: exec.signal })
        return {
          ok: r.ok,
          data: { server: state.serverInfo, session_id: state.sessionId, editor_state: r.ok ? r.data : null },
          error: r.error || null,
          hint: r.ok ? '连接正常，可开始开发/测试' : (r.hint || '见 error'),
        }
      }
    ))

    tools.push(makeTool(
      'godot_sessions',
      '列出所有已连接 Godot 编辑器的会话：session_id、项目路径、Godot 版本、插件版本、当前场景、播放状态、readiness。多开编辑器时用 godot_session_activate 切换目标。',
      {}, [],
      async function (args, exec) {
        return await callTool('session_manage', withSession({ op: 'list', params: {} }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_session_activate',
      '将后续工具调用固定到指定 Godot 编辑器会话。session_id 可传精确 id（如 my_game@a3f2，来自 godot_sessions）或项目文件夹名子串（如 "colonyFactory"）。',
      { session_id: { type: 'string', description: '精确 session id 或项目名子串' } },
      ['session_id'],
      async function (args, exec) {
        return await callTool('session_activate', { session_id: args.session_id }, { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_scene_tree',
      '读取当前编辑场景的节点树（分页扁平列表：name/type/path/子节点数）。路径基于场景根（如 /Main/Camera3D），不是运行时 /root/...。',
      {
        depth: { type: 'integer', description: '最大遍历深度，默认 10' },
        offset: { type: 'integer', description: '跳过的节点数，默认 0' },
        limit: { type: 'integer', description: '最多返回节点数，默认 100' },
      }, [],
      async function (args, exec) {
        return await callTool('scene_get_hierarchy', withSession({
          depth: args.depth === undefined ? 10 : args.depth,
          offset: args.offset === undefined ? 0 : args.offset,
          limit: args.limit === undefined ? 100 : args.limit,
        }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_scene_open',
      '在编辑器中打开场景文件（.tscn）。path 已是当前场景时为 no-op（保留未保存的内存修改）；force_reload=true 则从磁盘重读并丢弃未保存修改。',
      {
        path: { type: 'string', description: '场景文件路径，如 res://main.tscn' },
        force_reload: { type: 'boolean', description: '强制从磁盘重读，默认 false' },
      },
      ['path'],
      async function (args, exec) {
        return await callTool('scene_open', withSession({ path: args.path, force_reload: !!args.force_reload }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_scene_save',
      '保存当前编辑的场景到磁盘。',
      {}, [],
      async function (args, exec) {
        return await callTool('scene_save', withSession({}), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_scene_create',
      '新建场景并打开：创建 .tscn（指定根节点类型）或实例化已有 PackedScene。scene_path 非空时忽略 root_type。',
      {
        path: { type: 'string', description: '场景文件路径，如 res://levels/level1.tscn' },
        root_type: { type: 'string', description: '根节点类，如 Node3D/Node2D/Control，默认 Node3D' },
        root_name: { type: 'string', description: '根节点名，空则用文件名' },
      },
      ['path'],
      async function (args, exec) {
        const params = { path: args.path }
        if (args.root_type) params.root_type = args.root_type
        if (args.root_name) params.root_name = args.root_name
        return await callTool('scene_manage', withSession({ op: 'create', params: params }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_node_get',
      '读取节点属性快照。默认返回全部编辑器可见属性（50-150 项）；fields 可只取需要的属性以减小响应。path 是相对场景根的路径（如 /Main/Camera3D）。',
      {
        path: { type: 'string', description: '节点路径，相对场景根，如 /Main/Camera3D' },
        fields: { type: 'array', items: { type: 'string' }, description: '只返回这些属性名（可选）' },
      },
      ['path'],
      async function (args, exec) {
        const payload = { path: args.path }
        if (Array.isArray(args.fields) && args.fields.length > 0) payload.fields = args.fields
        return await callTool('node_get_properties', withSession(payload), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_node_create',
      '在场景树中创建（生成）节点：按 type 创建 Godot 节点类，或按 scene_path 实例化 PackedScene（两者互斥，scene_path 优先）。返回创建节点的完整路径在 data.path。',
      {
        type: { type: 'string', description: 'Godot 节点类，如 Node3D、MeshInstance3D' },
        name: { type: 'string', description: '节点名，空则 Godot 自动命名' },
        parent_path: { type: 'string', description: '父节点路径，相对场景根（如 /Main）；空=场景根' },
        scene_path: { type: 'string', description: '要实例化的 PackedScene 的 res:// 路径（可选，与 type 互斥）' },
      }, [],
      async function (args, exec) {
        const payload = {}
        if (args.type) payload.type = args.type
        if (args.name) payload.name = args.name
        if (args.parent_path) payload.parent_path = args.parent_path
        if (args.scene_path) payload.scene_path = args.scene_path
        return await callTool('node_create', withSession(payload), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_node_set',
      '设置节点属性。写前先用 godot_node_get 确认属性名与类型（Godot 属性名常与直觉不同，如 Camera3D 用 fov/current）。value 自动按属性类型转换：Vector2/3 用 {x,y[,z]}；Color 用 {r,g,b,a} 或 "#ff0000"；NodePath 用字符串；资源用 res:// 路径，传 null/"" 清除；内置资源可用 {"__class__":"BoxMesh",...}。',
      {
        path: { type: 'string', description: '节点路径，相对场景根' },
        property: { type: 'string', description: '属性名（必须与 Godot 精确一致），如 fov、position、mesh' },
        value: { description: '新值；null 或 ""（资源）表示清除' },
      },
      ['path', 'property', 'value'],
      async function (args, exec) {
        return await callTool('node_set_property', withSession({ path: args.path, property: args.property, value: args.value }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_node_find',
      '按名称/类型/组在场景树中查找节点（条件 AND，至少一个过滤条件）。name 为不区分大小写的子串匹配。',
      {
        name: { type: 'string', description: '节点名子串' },
        type: { type: 'string', description: '精确 Godot 类名，如 MeshInstance3D' },
        group: { type: 'string', description: '节点所属组名' },
        offset: { type: 'integer', description: '跳过数量，默认 0' },
        limit: { type: 'integer', description: '最多返回数量，默认 100' },
      }, [],
      async function (args, exec) {
        const payload = { offset: args.offset === undefined ? 0 : args.offset, limit: args.limit === undefined ? 100 : args.limit }
        if (args.name) payload.name = args.name
        if (args.type) payload.type = args.type
        if (args.group) payload.group = args.group
        return await callTool('node_find', withSession(payload), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_node_manage',
      '节点树操作（删除/复制/重命名/排序/重挂/分组）。op 必填，params 传该 op 的参数。常用：delete({path})、duplicate({path,name})、rename({path,new_name})、move({path,index})、reparent({path,new_parent})、add_to_group({path,group})、remove_from_group({path,group})、get_children({path})、get_groups({path})。不能删除/复制场景根；scene_file 可选作为场景守卫。',
      {
        op: { type: 'string', enum: ['get_children', 'get_groups', 'delete', 'duplicate', 'rename', 'move', 'reparent', 'add_to_group', 'remove_from_group'] },
        params: { type: 'object', description: 'op 的参数，如 {"path":"/Main/Enemy","new_name":"Boss"}' },
      },
      ['op'],
      async function (args, exec) {
        return await callTool('node_manage', withSession({ op: args.op, params: args.params || {} }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_script_create',
      '创建（覆盖）GDScript 源文件（.gd），触发文件系统扫描。新文件响应带 data.cleanup.rm（.gd + .gd.uid）。响应含 diagnostics（写后校验），headless 场景下这是 MCP 写入代码的错误通道。',
      {
        path: { type: 'string', description: 'res:// 路径，如 res://scripts/player.gd' },
        content: { type: 'string', description: 'GDScript 源码；空则创建空白文件' },
      },
      ['path'],
      async function (args, exec) {
        return await callTool('script_create', withSession({ path: args.path, content: args.content || '' }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_script_read',
      '读取 GDScript 源码：全文、行数、文件大小。',
      { path: { type: 'string', description: 'res:// 路径，如 res://scripts/player.gd' } },
      ['path'],
      async function (args, exec) {
        return await callTool('script_manage', withSession({ op: 'read', params: { path: args.path } }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_script_patch',
      '锚点式文本替换编辑 .gd：精确匹配 old_text 替换为 new_text（空白敏感）。多处匹配需 replace_all=true，零匹配报错。',
      {
        path: { type: 'string', description: 'res:// 路径，以 .gd 结尾' },
        old_text: { type: 'string', description: '要查找的精确子串，必须唯一（除非 replace_all）' },
        new_text: { type: 'string', description: '替换文本，空串=删除' },
        replace_all: { type: 'boolean', description: '替换所有出现，默认 false' },
      },
      ['path', 'old_text', 'new_text'],
      async function (args, exec) {
        return await callTool('script_patch', withSession({ path: args.path, old_text: args.old_text, new_text: args.new_text, replace_all: !!args.replace_all }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_script_attach',
      '给场景树节点挂载脚本（替换节点已有脚本）。',
      {
        path: { type: 'string', description: '节点场景路径，如 /Main/Player' },
        script_path: { type: 'string', description: '脚本 res:// 路径，如 res://scripts/player.gd' },
      },
      ['path', 'script_path'],
      async function (args, exec) {
        return await callTool('script_attach', withSession({ path: args.path, script_path: args.script_path }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_project_run',
      '从编辑器运行（播放）项目。mode: main=主场景（默认）/ current=当前打开场景 / custom=指定场景（需 scene）。已在运行则返回 was_already_running。autosave=true（默认）时运行前把内存中的 MCP 场景修改落盘；冒烟测试可传 false 保持内存。响应含 game_status（live/not_live/no_helper/break 等）判断游戏是否真正可交互。',
      {
        mode: { type: 'string', enum: ['main', 'current', 'custom'], description: '运行模式，默认 main' },
        scene: { type: 'string', description: '场景路径（mode=custom 时必填），如 res://levels/level1.tscn' },
        autosave: { type: 'boolean', description: '运行前自动保存 MCP 修改，默认 true' },
      }, [],
      async function (args, exec) {
        const payload = { mode: args.mode || 'main', autosave: args.autosave === undefined ? true : args.autosave }
        if (args.scene) payload.scene = args.scene
        return await callTool('project_run', withSession(payload), { timeoutMs: 120000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_project_stop',
      '停止运行中的游戏。幂等：未在运行也成功（was_running=false）。',
      {}, [],
      async function (args, exec) {
        return await callTool('project_manage', withSession({ op: 'stop', params: {} }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_project_settings',
      '读写 project.godot 项目设置。settings_get 读键（如 application/config/name）；settings_set 写键并持久化。',
      {
        op: { type: 'string', enum: ['settings_get', 'settings_set'] },
        key: { type: 'string', description: 'ProjectSettings 键，如 application/config/name' },
        value: { description: 'settings_set 时的新值' },
      },
      ['op', 'key'],
      async function (args, exec) {
        const params = { key: args.key }
        if (args.op === 'settings_set') params.value = args.value
        return await callTool('project_manage', withSession({ op: args.op, params: params }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_test_run',
      '在编辑器内运行 GDScript 测试套件（发现 res://tests/ 下 test_*.gd 并运行全部 test_* 方法）。默认返回汇总（计数、套件名、耗时）与失败项；verbose=true 返回每个用例。整轮预算 300s。若响应带 scene_warning，先 godot_scene_open 打开主场景再重跑。',
      {
        suite: { type: 'string', description: '只运行指定套件名（如 scene/node/editor）；空=全部' },
        test_name: { type: 'string', description: '只运行名称包含该子串的测试' },
        exclude_test_name: { type: 'string', description: '跳过名称包含该子串的测试' },
        verbose: { type: 'boolean', description: '包含每个用例结果，默认 false' },
      }, [],
      async function (args, exec) {
        const payload = { verbose: !!args.verbose }
        if (args.suite) payload.suite = args.suite
        if (args.test_name) payload.test_name = args.test_name
        if (args.exclude_test_name) payload.exclude_test_name = args.exclude_test_name
        return await callTool('test_run', withSession(payload), { timeoutMs: 320000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_test_results',
      '重新读取最近一次 godot_test_run 的结果（不重新执行）。verbose=true 含每个用例结果。',
      { verbose: { type: 'boolean', description: '包含每个用例结果，默认 false' } }, [],
      async function (args, exec) {
        return await callTool('test_manage', withSession({ op: 'results_get', params: { verbose: !!args.verbose } }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_game',
      '运行时游戏检查与输入模拟（需先 godot_project_run 启动，并用 godot_status 确认 live）。op 必填。常用：get_scene_tree({depth,root_path})、get_node_info({path,include_properties})、get_ui_elements({root_path,include_hidden,include_disabled,max_depth})（UI 测试）、input_key({key,pressed,echo})、input_mouse({event:"motion"|"button",position:{x,y},button,pressed})、input_gamepad({device,control:"button"|"axis",index,pressed,value})、input_action({action,pressed,strength})、input_sequence({steps:[{at_frame,action,pressed,strength}],settle_frames})（帧级时序输入，推荐）、input_state({actions})。',
      {
        op: { type: 'string', enum: ['get_scene_tree', 'get_node_info', 'get_ui_elements', 'input_key', 'input_mouse', 'input_gamepad', 'input_action', 'input_sequence', 'input_state'] },
        params: { type: 'object', description: 'op 的参数' },
      },
      ['op'],
      async function (args, exec) {
        return await callTool('game_manage', withSession({ op: args.op, params: args.params || {} }), { timeoutMs: 60000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_eval',
      '在运行中的游戏里执行 GDScript 表达式并返回结果（支持 await）。用于状态断言/临时逻辑。游戏未就绪、缺 _mcp_game_helper 或卡在断点会返回 EVAL_GAME_NOT_READY。',
      { code: { type: 'string', description: 'GDScript 代码，如 "get_tree().current_scene.name" 或 "var p = $Player\\nreturn p.position"' } },
      ['code'],
      async function (args, exec) {
        return await callTool('editor_manage', withSession({ op: 'game_eval', params: { code: args.code } }), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_logs',
      '读取日志。source: plugin（默认，MCP 插件流量）/ game（运行中游戏的 stdout/stderr/push_error，按 run_id 分）/ editor（编辑器脚本错误与 Debugger Errors 面板，排查红色报错用）/ all。include_details=true 带错误元数据与堆栈。增量轮询：editor 源用 since_cursor，game 源用 since_run_id。',
      {
        source: { type: 'string', enum: ['plugin', 'game', 'editor', 'all'], description: '日志来源，默认 plugin' },
        count: { type: 'integer', description: '最多返回行数，默认 50' },
        offset: { type: 'integer', description: '跳过行数，默认 0' },
        include_details: { type: 'boolean', description: '包含丰富错误元数据/堆栈，默认 false' },
        since_run_id: { type: 'string', description: '读取指定 run_id 的历史游戏日志' },
        since_cursor: { type: 'integer', description: 'editor 源增量游标（上次的 next_cursor）' },
      }, [],
      async function (args, exec) {
        const payload = { count: args.count === undefined ? 50 : args.count, offset: args.offset === undefined ? 0 : args.offset, source: args.source || 'plugin', include_details: !!args.include_details }
        if (args.since_run_id) payload.since_run_id = args.since_run_id
        if (args.since_cursor !== undefined && args.since_cursor !== null) payload.since_cursor = args.since_cursor
        return await callTool('logs_read', withSession(payload), { timeoutMs: 30000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_screenshot',
      '截图。source: viewport=编辑器 3D 视口（默认，需场景含 Node3D）/ viewport_2d=2D 视口 / cinematic=通过场景激活 Camera3D 渲染 / game=运行中游戏画面。include_image=true（默认）时把 PNG 保存到 out_dir（建议传工作区绝对路径，默认 godot_shots/），返回落盘路径供 read_image/visual_describe 查看。view_target 可指定取景节点，coverage=true 生成顶视参考图，elevation/azimuth/fov 控制相机。',
      {
        source: { type: 'string', enum: ['viewport', 'viewport_2d', 'cinematic', 'game'], description: '截图来源，默认 viewport' },
        max_resolution: { type: 'integer', description: '最长边分辨率，默认 640；0=全分辨率' },
        include_image: { type: 'boolean', description: '返回并保存图片，默认 true；false 只取元数据' },
        view_target: { type: 'string', description: '要取景的 Node3D 场景路径（逗号分隔）' },
        coverage: { type: 'boolean', description: '配合 view_target 生成双参考图+AABB' },
        elevation: { type: 'number', description: '相机仰角（度）' },
        azimuth: { type: 'number', description: '相机方位角（度）' },
        fov: { type: 'number', description: '相机 FOV（度），20-30 拉近，60-75 全景' },
        out_dir: { type: 'string', description: '保存目录（绝对路径更稳），默认相对 godot_shots/' },
        user_prompt: { type: 'string', description: '给视觉模型的上文说明（开启 Vision Routing 时随图发送）' },
      }, [],
      async function (args, exec) {
        const payload = withSession({
          source: args.source || 'viewport',
          max_resolution: args.max_resolution === undefined ? 640 : args.max_resolution,
          include_image: args.include_image === undefined ? true : args.include_image,
          view_target: args.view_target || '',
          coverage: !!args.coverage,
          elevation: args.elevation,
          azimuth: args.azimuth,
          fov: args.fov,
          user_prompt: args.user_prompt || '',
        })
        const r = await callTool('editor_screenshot', payload, { timeoutMs: 90000, signal: exec.signal, raw: true })
        if (!r.ok) return r
        const content = r.content || []
        const text = content.filter(function (c) { return c && c.type === 'text' }).map(function (c) { return c.text }).join('\n')
        let meta = null
        if (text) { try { meta = JSON.parse(text) } catch (e) { meta = text } }
        const images = content.filter(function (c) { return c && c.type === 'image' })
        const out = { ok: true, data: { source: args.source || 'viewport', metadata: meta, image: null } }
        if (images.length > 0 && fsService) {
          const img = images[0]
          const b64 = img.data || ''
          try {
            const pngPath = await saveBase64Png(b64, args.out_dir || '')
            out.data.image = { saved_to: pngPath, approx_bytes: Math.floor(b64.length * 3 / 4), mimeType: img.mimeType || 'image/png' }
            out.hint = '可用 read_image 或 visual_describe 查看 ' + pngPath
          } catch (e) {
            out.data.image = { save_failed: ((e && e.message) || String(e)), base64_length: b64.length }
          }
        }
        return out
      }
    ))

    tools.push(makeTool(
      'godot_batch',
      '原子批量执行多个编辑器子命令（顺序执行，遇错即停；undo=true 时失败自动回滚已成功的子命令）。commands 每项 {"command":"<插件命令名>","params":{...}}，用底层命令名（如 create_node/set_property/delete_node/attach_script），不是 MCP 工具名。适合"建节点+设属性+挂脚本"的组合编辑。',
      {
        commands: { type: 'array', items: { type: 'object' }, description: '[{"command":"create_node","params":{...}}, ...]' },
        undo: { type: 'boolean', description: '失败时回滚已成功的子命令，默认 true' },
      },
      ['commands'],
      async function (args, exec) {
        return await callTool('batch_execute', withSession({ commands: args.commands, undo: args.undo === undefined ? true : args.undo }), { timeoutMs: 120000, signal: exec.signal })
      }
    ))

    tools.push(makeTool(
      'godot_call',
      '通用透传：调用 Godot AI MCP 服务器的任意工具（含未单独包装的域）。tool 填服务器工具名，arguments 填该工具参数。未单独包装的常用工具：batch_execute、scene_manage(op: create/save_as/get_roots)、script_manage(op: read/detach/find_symbols)、editor_manage(op: state/selection_get/selection_set/monitors_get/quit/logs_clear/game_eval)、editor_reload_plugin、filesystem_manage(op: read_text/write_text/reimport/scan/search)、resource_manage(op: search/load/assign/get_info/create/...)、animation_manage、material_manage、audio_manage、particle_manage、camera_manage、signal_manage、input_map_manage、autoload_manage、theme_manage、ui_manage、api_manage、client_manage、tilemap_manage、tileset_manage、gridmap_manage、csg_manage。rollup 工具格式 {"op":"<verb>","params":{...}}；多编辑器可加顶层 session_id。',
      {
        tool: { type: 'string', description: '服务器工具名（如 animation_manage、filesystem_manage）' },
        arguments: { description: '该工具的参数对象' },
        timeout_ms: { type: 'integer', description: '超时毫秒，默认 60000' },
      },
      ['tool'],
      async function (args, exec) {
        const timeoutMs = (typeof args.timeout_ms === 'number' && args.timeout_ms > 0) ? args.timeout_ms : 60000
        let callArgs = (args.arguments && typeof args.arguments === 'object') ? args.arguments : {}
        if (state.sessionId && callArgs.session_id === undefined) {
          const copy = {}
          Object.keys(callArgs).forEach(function (k) { copy[k] = callArgs[k] })
          copy.session_id = state.sessionId
          callArgs = copy
        }
        return await callTool(args.tool, callArgs, { timeoutMs: timeoutMs, signal: exec.signal })
      }
    ))

    const disposers = []
    tools.forEach(function (def) {
      try {
        const d = harness.registerTool(ctx, def)
        if (typeof d === 'function') disposers.push(d)
      } catch (e) {
        console.log('[godot-ctrl] 注册 ' + def.name + ' 失败: ' + ((e && e.message) || String(e)))
      }
    })
    try {
      ctx.on('dispose', function () {
        disposers.forEach(function (d) { try { d() } catch (e) { /* ignore */ } })
      })
    } catch (e) { /* ignore */ }
    console.log('[godot-ctrl] 已注册 ' + disposers.length + ' 个 Godot 控制工具（目标 ' + state.baseUrl + '）')
  },
}
