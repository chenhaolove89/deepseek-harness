// godot-ctrl 联测：镜像插件 host.js 的 MCP streamable-HTTP 客户端逻辑（curl spawn + 解析）。
// 用法：node godot-mcp-test.mjs [baseUrl]
import { spawn } from 'node:child_process'

const baseUrl = process.argv[2] || 'http://127.0.0.1:8000/mcp'

function curlPost(body, { timeoutMs = 15000, sessionId = '' } = {}) {
  return new Promise((resolve) => {
    const argv = [
      'curl', '-sS', '-m', String(Math.ceil(timeoutMs / 1000)), '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-H', 'Accept: application/json, text/event-stream',
      '-H', 'Expect:',
    ]
    if (sessionId) argv.push('-H', 'Mcp-Session-Id: ' + sessionId)
    argv.push('-i', '--data-binary', '@-', baseUrl)
    const child = spawn('curl', argv, { stdio: ['pipe', 'pipe', 'pipe'] })
    let outText = ''
    let errText = ''
    child.stdout.on('data', (d) => { outText += d.toString() })
    child.stderr.on('data', (d) => { errText += d.toString() })
    child.on('error', (e) => resolve({ error: { code: 'SPAWN', message: String(e.message) } }))
    child.on('close', (code) => {
      if (code !== 0) {
        let c = 'CURL_ERROR', m = 'curl exit ' + code + (errText ? ':' + errText.slice(0, 200) : '')
        if (code === 7) { c = 'GODOT_UNREACHABLE'; m = 'cannot connect ' + baseUrl }
        if (code === 28) { c = 'TIMEOUT'; m = 'timeout ' + timeoutMs + 'ms' }
        return resolve({ error: { code: c, message: m } })
      }
      const last = outText.indexOf('\r\n\r\n')
      const headers = last >= 0 ? outText.slice(0, last) : outText
      const bodyText = last >= 0 ? outText.slice(last + 4) : ''
      const m2 = /^mcp-session-id:\s*(.+)$/im.exec(headers)
      const sm = /^HTTP\/\S+\s+(\d+)/m.exec(headers)
      const status = sm ? Number(sm[1]) : 0
      resolve({ status, body: bodyText, sessionId: m2 ? m2[1].trim() : '', raw: outText.slice(0, 200) })
    })
    child.stdin.end(body)
  })
}

function parseMcpBody(raw) {
  const text = String(raw || '')
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) { try { return JSON.parse(trimmed) } catch {} }
  const dataLines = []
  text.split(/\r?\n/).forEach((line) => { if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim()) })
  if (dataLines.length) { try { return JSON.parse(dataLines.join('\n')) } catch {} }
  return null
}

async function mcp(method, params, sessionId) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e9), method, params: params || {} })
  const res = await curlPost(body, { timeoutMs: 60000, sessionId })
  if (res.error) return { ok: false, error: res.error }
  const msg = parseMcpBody(res.body)
  if (!msg) return { ok: false, error: { code: 'BAD_RESPONSE', message: 'unparseable', raw: res.raw } }
  if (msg.error) return { ok: false, error: msg.error, sessionId: res.sessionId }
  return { ok: true, result: msg.result, sessionId: res.sessionId }
}

const report = {}
const init = await curlPost(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'godot-ctrl-test', version: '1.0.0' } },
}), { timeoutMs: 15000 })
report.initialize = init.error ? init : { status: init.status, sessionId: init.sessionId, parsed: parseMcpBody(init.body) }

let sid = init.sessionId || ''
if (!init.error && report.initialize.parsed && !report.initialize.parsed.error) {
  await curlPost(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), { timeoutMs: 5000, sessionId: sid }).catch(() => {})
  for (const [name, args] of [
    ['editor_state', {}],
    ['session_manage', { op: 'list', params: {} }],
    ['scene_get_hierarchy', { depth: 10, offset: 0, limit: 100 }],
    ['project_manage', { op: 'settings_get', params: { key: 'application/config/name' } }],
  ]) {
    const r = await mcp('tools/call', { name, arguments: args }, sid)
    if (r.sessionId) sid = r.sessionId
    report['tools/call ' + name] = r.ok
      ? { ok: true, hasStructured: r.result && r.result.structuredContent !== undefined, contentTypes: (r.result && r.result.content || []).map((c) => c.type), preview: JSON.stringify(r.result && (r.result.structuredContent ?? r.result.content)).slice(0, 300) }
      : { ok: false, error: r.error }
  }
}
console.log(JSON.stringify(report, null, 2))
