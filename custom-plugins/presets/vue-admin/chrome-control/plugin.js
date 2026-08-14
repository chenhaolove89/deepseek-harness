// chrome-control — preset-plane Chrome control plugin for the vue-admin preset.
// A real Cordis plugin (not a dynamic one): spawns the chrome-helper process via
// the subprocess service and registers the chrome_* model tools into this
// preset's standing scope, so every vue-admin session can drive a dedicated
// Chrome instance over the DevTools Protocol.
//
// Depends on the chrome-helper.mjs file beside this module (resolved from
// import.meta.url, so the pair travel together with the preset).
//
// Deliberately has NO bare-package imports: a relative preset row resolves
// against the preset directory, where the user's home has no node_modules, so
// any `@deepseek-ai/*` import would fail. Tool definitions are hand-built
// ToolDefinition objects, which `ctx.tools.register` accepts directly.
import { fileURLToPath } from 'node:url'

const HELPER_PATH = fileURLToPath(new URL('./chrome-helper.mjs', import.meta.url))

export default {
  name: 'chrome-control',
  inject: ['tools', 'timer'],
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    const fsSvc = ctx.get('fs')
    if (subprocess === undefined || fsSvc === undefined) {
      console.error('[chrome-control] subprocess or fs service unavailable')
      return
    }

    let workspaceRoot = null
    const sandboxPolicy = ctx.get('sandboxPolicy')
    if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string') workspaceRoot = sandboxPolicy.workspaceRoot

    const helper = { handle: null, alive: false, nextId: 1, pending: new Map(), buffer: '', stderrTail: '' }
    let chain = Promise.resolve()

    async function baseDir() {
      if (workspaceRoot) return workspaceRoot
      return fsSvc.processPath(await fsSvc.resolve('.'))
    }

    async function spawnHelper() {
      if (helper.alive && helper.handle) return
      const node = await subprocess.resolveExecutable('node')
      const handle = subprocess.spawn({
        argv: [node, HELPER_PATH],
        cwd: await baseDir(),
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 16384 } },
        graceMs: 3000,
      })
      helper.handle = handle
      helper.alive = true
      helper.pending.clear()
      helper.buffer = ''
      handle.stdout.on('data', (chunk) => {
        helper.buffer += chunk.toString('utf8')
        let idx
        while ((idx = helper.buffer.indexOf('\n')) >= 0) {
          const line = helper.buffer.slice(0, idx).trim()
          helper.buffer = helper.buffer.slice(idx + 1)
          if (!line) continue
          let msg
          try { msg = JSON.parse(line) } catch { continue }
          if (msg.id != null && helper.pending.has(msg.id)) {
            const p = helper.pending.get(msg.id)
            helper.pending.delete(msg.id)
            if (msg.error) p.reject(new Error(msg.error.message))
            else p.resolve(msg.result)
          }
        }
      })
      const stderrReader = handle.collected.stderr
      const fail = (error) => {
        helper.alive = false
        if (helper.handle === handle) helper.handle = null
        for (const p of helper.pending.values()) p.reject(error)
        helper.pending.clear()
      }
      handle.done.then((outcome) => {
        if (stderrReader) {
          const read = stderrReader.readFrom(0)
          helper.stderrTail = read.text
        }
        fail(new Error('chrome helper exited (code ' + outcome.exitCode + ')' + (helper.stderrTail ? ': ' + helper.stderrTail.slice(-400) : '')))
      }).catch((error) => {
        fail(new Error('chrome helper failed: ' + (error && error.message)))
      })
    }

    async function rpc(method, params, timeoutMs) {
      await spawnHelper()
      if (!helper.alive || !helper.handle) throw new Error('chrome helper not running')
      const id = helper.nextId++
      const payload = JSON.stringify({ id, method, params: params || {} })
      return new Promise((resolve, reject) => {
        const cancel = ctx.timeout(() => {
          helper.pending.delete(id)
          reject(new Error('chrome ' + method + ' timed out after ' + (timeoutMs || 60000) + 'ms'))
        }, timeoutMs || 60000)
        helper.pending.set(id, {
          resolve: (value) => { cancel(); resolve(value) },
          reject: (error) => { cancel(); reject(error) },
        })
        helper.handle.stdin.write(payload + '\n')
      })
    }

    function serial(executor) {
      return (...args) => {
        const run = chain.then(() => executor(...args))
        chain = run.catch(() => {})
        return run
      }
    }

    function contentTool(name, description, parameters, executor) {
      return {
        name,
        description,
        parameters,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render(_args, value) {
            return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
          },
        },
        async execute(args) {
          return executor(args)
        },
      }
    }

    const TOOLS = [
      {
        name: 'chrome_open',
        description: '启动一个专属的 Chrome 实例(独立用户目录+CDP 远程调试)并返回其标签页列表。Chrome 尚未打开时,其他 chrome_* 工具会提示先调用本工具。headless 为 true 时以无头模式运行。',
        parameters: {
          url: { type: 'string', description: '启动后打开的网址,默认 about:blank' },
          headless: { type: 'boolean', description: '是否以无头模式运行(默认 false)' },
        },
        exec: (args) => rpc('open', { url: args.url, headless: args.headless === true }, 75000),
      },
      {
        name: 'chrome_status',
        description: '查看 Chrome 是否打开以及当前所有标签页(含 tab_id、标题、URL)。',
        parameters: {},
        exec: () => rpc('status', {}, 15000),
      },
      {
        name: 'chrome_goto',
        description: '在当前(或指定)标签页导航到 url,并等待页面加载完成。',
        parameters: {
          url: { type: 'string', required: true, description: '要打开的完整 URL' },
          tab_id: { type: 'string', description: '目标标签页 id,省略则用当前标签页' },
        },
        exec: (args) => rpc('goto', { url: args.url, tabId: args.tab_id }, 90000),
      },
      {
        name: 'chrome_back',
        description: '当前(或指定)标签页后退一步。',
        parameters: { tab_id: { type: 'string', description: '标签页 id' } },
        exec: (args) => rpc('back', { tabId: args.tab_id }, 45000),
      },
      {
        name: 'chrome_forward',
        description: '当前(或指定)标签页前进一步。',
        parameters: { tab_id: { type: 'string', description: '标签页 id' } },
        exec: (args) => rpc('forward', { tabId: args.tab_id }, 45000),
      },
      {
        name: 'chrome_reload',
        description: '重新加载当前(或指定)标签页。',
        parameters: { tab_id: { type: 'string', description: '标签页 id' } },
        exec: (args) => rpc('reload', { tabId: args.tab_id }, 45000),
      },
      {
        name: 'chrome_new_tab',
        description: '新建一个标签页(可带 url),并设为当前标签页。',
        parameters: { url: { type: 'string', description: '新标签页打开的网址' } },
        exec: (args) => rpc('newTab', { url: args.url }, 30000),
      },
      {
        name: 'chrome_close_tab',
        description: '关闭指定标签页。',
        parameters: { tab_id: { type: 'string', required: true, description: '要关闭的标签页 id' } },
        exec: (args) => rpc('closeTab', { tabId: args.tab_id }, 30000),
      },
      {
        name: 'chrome_dom',
        description: '获取当前(或指定)标签页可见可交互元素的 DOM 快照。每个元素有 nid(如 e1/e2)与矩形坐标,后续可用 chrome_click/node_id 点击、chrome_type/node_id 聚焦输入、chrome_scroll/node_id 滚动。',
        parameters: { tab_id: { type: 'string', description: '标签页 id' } },
        exec: (args) => rpc('dom', { tabId: args.tab_id }, 30000),
      },
      {
        name: 'chrome_click',
        description: '点击元素。优先用 node_id(chrome_dom 快照中的 nid,会自动滚动到可见并点击中心);也可用 x/y 视口坐标点击。',
        parameters: {
          node_id: { type: 'string', description: 'chrome_dom 返回的 nid' },
          x: { type: 'number', description: '视口 x 坐标(与 y 一起使用)' },
          y: { type: 'number', description: '视口 y 坐标(与 x 一起使用)' },
          tab_id: { type: 'string', description: '标签页 id' },
        },
        exec: (args) => rpc('click', { nodeId: args.node_id, x: args.x, y: args.y, tabId: args.tab_id }, 30000),
      },
      {
        name: 'chrome_type',
        description: '在当前焦点处输入文本。若给出 node_id 会先点击聚焦该元素。',
        parameters: {
          text: { type: 'string', required: true, description: '要输入的文本' },
          node_id: { type: 'string', description: '先聚焦的目标 nid' },
          tab_id: { type: 'string', description: '标签页 id' },
        },
        exec: (args) => rpc('type', { text: args.text, nodeId: args.node_id, tabId: args.tab_id }, 30000),
      },
      {
        name: 'chrome_keypress',
        description: '按组合键。keys 支持 Enter/Tab/Escape/Backspace/Delete/Home/End/PageUp/PageDown/ArrowUp/ArrowDown/ArrowLeft/ArrowRight/Space/F1-F12 及单个字符,修饰键 Control/Alt/Shift/Meta 可与普通键组合,如 ["Control","a"] 全选、["Enter"] 回车。',
        parameters: {
          keys: { type: 'array', required: true, items: { type: 'string' }, description: '按键序列' },
          tab_id: { type: 'string', description: '标签页 id' },
        },
        exec: (args) => rpc('keypress', { keys: args.keys, tabId: args.tab_id }, 30000),
      },
      {
        name: 'chrome_scroll',
        description: '滚动页面。x/y 为滚动像素(正数向下/向右);若给 node_id 则在指定元素内滚动。',
        parameters: {
          x: { type: 'number', description: '水平滚动量' },
          y: { type: 'number', description: '垂直滚动量' },
          node_id: { type: 'string', description: '在指定元素内滚动' },
          tab_id: { type: 'string', description: '标签页 id' },
        },
        exec: (args) => rpc('scroll', { x: args.x, y: args.y, nodeId: args.node_id, tabId: args.tab_id }, 30000),
      },
      {
        name: 'chrome_screenshot',
        description: '截取当前(或指定)标签页截图,保存为 PNG 文件并返回路径。full_page 为 true 时截取整页。可用 read_image 查看生成的图片。',
        parameters: {
          tab_id: { type: 'string', description: '标签页 id' },
          full_page: { type: 'boolean', description: '是否整页截图(默认 false,仅视口)' },
          name: { type: 'string', description: '截图文件名(不含扩展名)' },
        },
        exec: async (args) => rpc('screenshot', {
          tabId: args.tab_id,
          fullPage: args.full_page === true,
          name: args.name,
          dir: (await baseDir()) + '/.dsh-chrome/screenshots',
        }, 45000),
      },
      {
        name: 'chrome_eval',
        description: '在当前(或指定)标签页执行 JavaScript 表达式并返回结果值(只读诊断用途,如读取页面状态/数据)。await_promise 为 true 时等待 Promise 完成。',
        parameters: {
          expression: { type: 'string', required: true, description: '要执行的 JS 表达式' },
          tab_id: { type: 'string', description: '标签页 id' },
          await_promise: { type: 'boolean', description: '是否等待 Promise(默认 false)' },
        },
        exec: (args) => rpc('eval', { expression: args.expression, tabId: args.tab_id, awaitPromise: args.await_promise }, 30000),
      },
      {
        name: 'chrome_close',
        description: '关闭 Chrome 实例并终止后台辅助进程。调用后如需再使用,重新 chrome_open 即可。',
        parameters: {},
        exec: async () => {
          const result = await rpc('close', {}, 20000)
          if (helper.handle) helper.handle.terminate()
          helper.alive = false
          helper.handle = null
          return result
        },
      },
    ]

    const disposers = []
    for (const tool of TOOLS) {
      disposers.push(ctx.tools.register(contentTool(tool.name, tool.description, tool.parameters, serial(tool.exec))))
    }
    ctx.effect(() => () => {
      for (const disposer of disposers) disposer()
      if (helper.handle) helper.handle.terminate()
    })
    console.log('[chrome-control] registered ' + TOOLS.length + ' tools')
  },
}
