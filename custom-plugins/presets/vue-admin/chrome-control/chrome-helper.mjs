// chrome-helper.mjs — CDP bridge for the DSH chrome-control plugin.
// A standalone Node (>= 22) process: receives JSON-line RPC on stdin, answers on
// stdout, and drives a dedicated Chrome instance over the DevTools Protocol.
// Transport: one browser-level WebSocket; every page command goes through the
// legacy Target.sendMessageToTarget path (flatten:true was unresponsive on the
// Chrome builds this was written against).
// `node chrome-helper.mjs --selftest` runs a scripted end-to-end check.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { get as httpGet } from 'node:http'
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import readline from 'node:readline'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Progress traces for selftest debugging (stderr so stdout stays protocol-clean).
const trace = (message) => {
  if (process.argv.includes('--selftest')) process.stderr.write(`[trace] ${message}\n`)
}

// ---------------------------------------------------------------- chrome path

function chromeFromRegistry() {
  if (process.platform !== 'win32') return null
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'
  const out = spawnSync('reg', ['query', key, '/ve'], { encoding: 'utf8' })
  if (out.status !== 0 || !out.stdout) return null
  const match = out.stdout.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
  return match ? match[1].trim() : null
}

function findChrome() {
  if (process.env.DSH_CHROME_PATH && existsSync(process.env.DSH_CHROME_PATH)) {
    return process.env.DSH_CHROME_PATH
  }
  const fromRegistry = chromeFromRegistry()
  if (fromRegistry && existsSync(fromRegistry)) return fromRegistry
  const candidates = []
  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean)
    for (const root of roots) {
      candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    }
    for (const candidate of candidates) if (existsSync(candidate)) return candidate
    return 'chrome' // PATH fallback
  }
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  }
  return 'google-chrome' // linux PATH fallback
}

// ------------------------------------------------------------------ http cdp

function httpJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, { method }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch {
          reject(new Error(`non-JSON response from ${url}: ${data.slice(0, 160)}`))
        }
      })
    })
    req.on('error', reject)
  })
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

// ---------------------------------------------------------------- cdp client

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.closed = false
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true })
      this.ws.addEventListener('error', () => reject(new Error('WebSocket connect failed')), { once: true })
    })
    this.ws.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message.id != null) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message || 'CDP error'))
        else pending.resolve(message.result || {})
        return
      }
      const listeners = this.listeners.get(message.method)
      if (listeners) for (const listener of listeners) listener(message.params || {})
    })
    this.ws.addEventListener('close', () => {
      this.closed = true
      const error = new Error('CDP connection closed')
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    })
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('CDP connection closed'))
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set()
    listeners.add(listener)
    this.listeners.set(method, listeners)
  }

  off(method, listener) {
    const listeners = this.listeners.get(method)
    if (listeners) listeners.delete(listener)
  }

  close() {
    try { this.ws?.close() } catch { /* already closed */ }
  }
}

// -------------------------------------------------------------------- state

const state = {
  chromeProc: null,
  port: null,
  profile: null,
  version: null,
  browser: null, // CdpSession on the browser-level WebSocket
  selectedTabId: null,
  tabSessions: new Map(), // targetId -> { sessionId, nextInnerId, pending, listeners }
  closed: false,
}

async function listTabs() {
  if (!state.port) return []
  const targets = await httpJson(`http://127.0.0.1:${state.port}/json/list`)
  return targets
    .filter((target) => target.type === 'page')
    .map((target) => ({ id: target.id, title: target.title || '', url: target.url }))
}

async function selectedTab() {
  if (state.selectedTabId) return state.selectedTabId
  const tabs = await listTabs()
  if (tabs.length === 0) throw new Error('no open tabs')
  state.selectedTabId = tabs[0].id
  return state.selectedTabId
}

// Attach to a tab target and return its legacy session handle.
async function tabSession(targetId) {
  const targetIdResolved = targetId || (await selectedTab())
  let tab = state.tabSessions.get(targetIdResolved)
  if (tab) return { tab, targetId: targetIdResolved }
  const attach = await state.browser.send('Target.attachToTarget', {
    targetId: targetIdResolved,
    flatten: false,
  })
  const sessionId = attach.sessionId
  trace(`tabSession: attached ${targetIdResolved} sid=${sessionId}`)
  tab = {
    sessionId,
    nextInnerId: 1,
    pending: new Map(),
    listeners: new Map(),
  }
  state.tabSessions.set(targetIdResolved, tab)
  return { tab, targetId: targetIdResolved }
}

function sendToTab(tab, method, params = {}) {
  return new Promise((resolve, reject) => {
    const innerId = tab.nextInnerId++
    tab.pending.set(innerId, { resolve, reject })
    state.browser.send('Target.sendMessageToTarget', {
      sessionId: tab.sessionId,
      message: JSON.stringify({ id: innerId, method, params }),
    }).catch((error) => {
      tab.pending.delete(innerId)
      reject(error)
    })
  })
}

function tabOn(tab, method, listener) {
  const listeners = tab.listeners.get(method) || new Set()
  listeners.add(listener)
  tab.listeners.set(method, listeners)
  return () => {
    listeners.delete(listener)
  }
}

// Route Target.receivedMessageFromTarget events to the owning tab session.
function routeTabMessages(params) {
  trace(`route: session=${params.sessionId} len=${(params.message || '').length}`)
  for (const tab of state.tabSessions.values()) {
    if (tab.sessionId !== params.sessionId) continue
    let inner
    try { inner = JSON.parse(params.message) } catch { return }
    if (inner.id != null) {
      const pending = tab.pending.get(inner.id)
      if (!pending) return
      tab.pending.delete(inner.id)
      if (inner.error) pending.reject(new Error(inner.error.message || 'CDP error'))
      else pending.resolve(inner.result || {})
      return
    }
    const listeners = tab.listeners.get(inner.method)
    if (listeners) for (const listener of listeners) listener(inner.params || {})
    return
  }
}

async function tabUrl(tabId) {
  const targets = await httpJson(`http://127.0.0.1:${state.port}/json/list`)
  const target = targets.find((entry) => entry.id === tabId)
  return target ? target.url : null
}

// ------------------------------------------------------------- in-page code

function domSnapshot() {
  const INTERACTIVE = [
    'a', 'button', 'input', 'textarea', 'select', 'summary', 'label', 'details',
    '[contenteditable="true"]', '[onclick]', '[role]',
  ].join(',')
  const results = []
  let nextId = 1
  const visible = (element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (Number(style.opacity) === 0) return false
    return true
  }
  const elements = document.documentElement.querySelectorAll('*')
  for (const element of elements) {
    if (element.closest('script,style,noscript,head,meta,link,title,base,iframe')) continue
    if (!visible(element)) continue
    const tag = element.tagName.toLowerCase()
    const interactive = element.matches(INTERACTIVE)
      || typeof element.onclick === 'function'
      || element.getAttribute('role') !== null
    if (!interactive) continue
    if (results.length >= 300) break
    const nid = 'e' + nextId++
    element.setAttribute('data-dsh-nid', nid)
    const rect = element.getBoundingClientRect()
    const text = (element.innerText || element.value || element.getAttribute('aria-label') || element.title || '')
      .replace(/\s+/g, ' ').trim().slice(0, 140)
    const ariaLabel = element.getAttribute('aria-label')
    results.push({
      nid,
      tag,
      role: element.getAttribute('role'),
      text,
      value: element.value !== undefined ? String(element.value).slice(0, 140) : null,
      href: element.getAttribute('href'),
      aria: ariaLabel || null,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      checked: element.checked === true,
      type: element.getAttribute('type'),
    })
  }
  return {
    count: results.length,
    url: location.href,
    title: document.title,
    viewport: { w: innerWidth, h: innerHeight },
    elements: results,
  }
}

function locateNode(nid) {
  return new Promise((resolve) => {
    const element = document.querySelector(`[data-dsh-nid="${nid}"]`)
    if (!element) return resolve({ ok: false, error: `node not found: ${nid}` })
    element.scrollIntoView({ block: 'center', inline: 'center' })
    setTimeout(() => {
      const rect = element.getBoundingClientRect()
      resolve({
        ok: true,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      })
    }, 80)
  })
}

function scrollNode(nid, deltaX, deltaY) {
  return new Promise((resolve) => {
    const element = document.querySelector(`[data-dsh-nid="${nid}"]`)
    if (!element) return resolve({ ok: false, error: `node not found: ${nid}` })
    element.scrollBy({ left: deltaX || 0, top: deltaY || 0, behavior: 'instant' })
    resolve({ ok: true })
  })
}

function evaluateOnTab(tab, expression, awaitPromise) {
  return sendToTab(tab, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: awaitPromise === true,
  })
}

// ----------------------------------------------------------------- commands

async function cmdOpen(params) {
  if (state.port) return status()
  const chromeExe = params.chromePath || findChrome()
  trace(`open: chrome=${chromeExe}`)
  const port = params.port || (await findFreePort())
  trace(`open: port=${port}`)
  const profile = params.userDataDir || path.join(os.tmpdir(), `dsh-chrome-${randomUUID().slice(0, 8)}`)
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--remote-allow-origins=*',
    '--window-size=1280,900',
  ]
  if (params.headless) args.push('--headless=new')
  args.push(params.url || 'about:blank')

  let chromeProcess
  try {
    chromeProcess = spawn(chromeExe, args, { stdio: 'ignore', windowsHide: false })
  } catch (error) {
    throw new Error(`failed to launch Chrome (${chromeExe}): ${error.message}`)
  }
  state.chromeProc = chromeProcess
  state.port = port
  state.profile = profile
  trace('open: spawned')

  let version = null
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      version = await httpJson(`http://127.0.0.1:${port}/json/version`)
      break
    } catch {
      if (chromeProcess.exitCode !== null) {
        throw new Error(`Chrome exited during startup (code ${chromeProcess.exitCode})`)
      }
      await sleep(200)
    }
  }
  if (!version) {
    chromeProcess.kill()
    state.chromeProc = null
    state.port = null
    state.profile = null
    throw new Error('Chrome did not expose a debugging endpoint in 60s; the machine may be under heavy load')
  }
  state.version = version
  trace(`open: version=${version.Browser}`)

  const browser = new CdpSession(version.webSocketDebuggerUrl)
  await browser.connect()
  browser.on('Target.receivedMessageFromTarget', routeTabMessages)
  state.browser = browser
  trace('open: browser ws connected')

  const tabs = await listTabs()
  if (tabs.length > 0) state.selectedTabId = tabs[0].id
  return {
    port,
    browser: version.Browser,
    protocolVersion: version['Protocol-Version'],
    userDataDir: profile,
    tabs,
  }
}

async function cmdStatus() {
  if (!state.port) return { open: false, tabs: [] }
  return {
    open: true,
    port: state.port,
    browser: state.version ? state.version.Browser : null,
    selectedTabId: state.selectedTabId,
    tabs: await listTabs(),
  }
}

async function cmdNewTab(params) {
  requireChrome()
  const url = params.url || 'about:blank'
  const created = await state.browser.send('Target.createTarget', { url })
  const targetId = created.targetId
  state.selectedTabId = targetId
  const urlAfter = await tabUrl(targetId)
  return { id: targetId, url: urlAfter, title: '' }
}

// Wait for the next Page.loadEventFired on a tab, bounded by a timeout.
function waitForLoad(tab, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      off()
      resolve()
    }
    const off = tabOn(tab, 'Page.loadEventFired', finish)
    const timer = setTimeout(finish, timeoutMs)
  })
}

async function cmdGoto(params) {
  requireChrome()
  const { tab, targetId } = await tabSession(params.tabId)
  const waited = waitForLoad(tab, params.timeoutMs || 20000)
  const result = await sendToTab(tab, 'Page.navigate', { url: params.url })
  if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`)
  await waited
  state.selectedTabId = targetId
  return { tabId: targetId, url: await tabUrl(targetId) }
}

async function cmdBack(params) {
  requireChrome()
  const { tab, targetId } = await tabSession(params.tabId)
  const waited = waitForLoad(tab, 15000)
  await sendToTab(tab, 'Page.goBack').catch(() => {})
  await waited
  state.selectedTabId = targetId
  return { tabId: targetId, url: await tabUrl(targetId) }
}

async function cmdForward(params) {
  requireChrome()
  const { tab, targetId } = await tabSession(params.tabId)
  const waited = waitForLoad(tab, 15000)
  await sendToTab(tab, 'Page.goForward').catch(() => {})
  await waited
  state.selectedTabId = targetId
  return { tabId: targetId, url: await tabUrl(targetId) }
}

async function cmdReload(params) {
  requireChrome()
  const { tab, targetId } = await tabSession(params.tabId)
  const waited = waitForLoad(tab, 15000)
  await sendToTab(tab, 'Page.reload', { ignoreCache: false })
  await waited
  state.selectedTabId = targetId
  return { tabId: targetId, url: await tabUrl(targetId) }
}

async function cmdCloseTab(params) {
  requireChrome()
  await state.browser.send('Target.closeTarget', { targetId: params.tabId }).catch(() => {})
  state.tabSessions.delete(params.tabId)
  if (state.selectedTabId === params.tabId) state.selectedTabId = null
  return { closed: params.tabId, tabs: await listTabs() }
}

async function cmdActivate(params) {
  requireChrome()
  await state.browser.send('Target.activateTarget', { targetId: params.tabId })
  state.selectedTabId = params.tabId
  return { activated: params.tabId }
}

async function cmdDom(params) {
  requireChrome()
  const { tab } = await tabSession(params.tabId)
  const result = await evaluateOnTab(tab, `(${domSnapshot.toString()})()`)
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result.value
}

async function cmdClick(params) {
  requireChrome()
  const { tab, targetId } = await tabSession(params.tabId)
  let point = null
  if (params.nodeId) {
    const result = await evaluateOnTab(tab, `(${locateNode.toString()})(${JSON.stringify(params.nodeId)})`, true)
    const located = result.result && result.result.value
    if (!located || !located.ok) {
      throw new Error(located ? located.error : 'failed to locate node')
    }
    point = located
  } else if (typeof params.x === 'number' && typeof params.y === 'number') {
    point = { x: Math.round(params.x), y: Math.round(params.y) }
  } else {
    throw new Error('click requires node_id or x/y coordinates')
  }
  await sendToTab(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await sendToTab(tab, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
  })
  await sendToTab(tab, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
  })
  state.selectedTabId = targetId
  return { clicked: { x: point.x, y: point.y }, nodeId: params.nodeId || null, tabId: targetId }
}

async function cmdType(params) {
  requireChrome()
  const { tab, targetId } = await tabSession(params.tabId)
  if (params.nodeId) await cmdClick({ ...params, tabId: targetId })
  await sendToTab(tab, 'Input.insertText', { text: params.text })
  state.selectedTabId = targetId
  return { typedLength: params.text.length, tabId: targetId }
}

const KEY_CODES = {
  Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, Insert: 45,
  Home: 36, End: 35, PageUp: 33, PageDown: 34,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  Space: 32, ' ': 32,
}
for (let index = 1; index <= 12; index++) KEY_CODES[`F${index}`] = 111 + index

const MODIFIER_CODES = { Control: 2, Alt: 1, Shift: 8, Meta: 4 }

async function cmdKeypress(params) {
  requireChrome()
  const { tab, targetId } = await tabSession(params.tabId)
  const keys = params.keys || []
  let modifiers = 0
  const presses = []
  for (const key of keys) {
    const mod = MODIFIER_CODES[key]
    if (mod) modifiers |= mod
    else presses.push(key)
  }
  for (const key of presses) {
    let code = KEY_CODES[key]
    let text = ''
    if (code === undefined) {
      if (key.length !== 1) throw new Error(`unsupported key: ${key}`)
      code = key.toUpperCase().charCodeAt(0)
      if (!(modifiers & 2)) text = key
    }
    await sendToTab(tab, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      modifiers,
      ...(text ? { text } : {}),
    })
    await sendToTab(tab, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      modifiers,
    })
  }
  state.selectedTabId = targetId
  return { keys, modifiers, tabId: targetId }
}

async function cmdScroll(params) {
  requireChrome()
  const { tab, targetId } = await tabSession(params.tabId)
  if (params.nodeId) {
    const result = await evaluateOnTab(
      tab,
      `(${scrollNode.toString()})(${JSON.stringify(params.nodeId)}, ${params.x || 0}, ${params.y || 0})`,
      true,
    )
    if (result.exceptionDetails) throw new Error('scroll failed')
    const value = result.result && result.result.value
    if (value && value.ok === false) throw new Error(value.error)
  } else {
    await sendToTab(tab, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: 500, y: 300, deltaX: params.x || 0, deltaY: params.y || 0,
    })
  }
  state.selectedTabId = targetId
  return { x: params.x || 0, y: params.y || 0, tabId: targetId }
}

async function cmdScreenshot(params) {
  requireChrome()
  const { tab, targetId } = await tabSession(params.tabId)
  const result = await sendToTab(tab, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: params.fullPage === true,
    fromSurface: true,
  })
  const buffer = Buffer.from(result.data, 'base64')
  const directory = params.dir || os.tmpdir()
  await mkdir(directory, { recursive: true })
  const name = params.name || `shot-${Date.now()}`
  const file = path.join(directory, `${name}.png`)
  await writeFile(file, buffer)
  state.selectedTabId = targetId
  return { path: file, bytes: buffer.length, fullPage: params.fullPage === true, tabId: targetId }
}

async function cmdEval(params) {
  requireChrome()
  const { tab } = await tabSession(params.tabId)
  const result = await evaluateOnTab(tab, params.expression, params.awaitPromise)
  if (result.exceptionDetails) {
    const details = result.exceptionDetails
    return {
      ok: false,
      error: details.exception?.description || details.text || 'evaluation threw',
    }
  }
  const value = result.result
  if (value.subtype === 'error') return { ok: false, error: value.description }
  return { ok: true, value: value.value !== undefined ? value.value : value.description }
}

async function cmdTitle(params) {
  requireChrome()
  const { tab } = await tabSession(params.tabId)
  const result = await evaluateOnTab(tab, 'document.title')
  return { title: result.result && result.result.value }
}

async function cmdUrl(params) {
  requireChrome()
  const targetId = params.tabId || (await selectedTab())
  return { url: await tabUrl(targetId), tabId: targetId }
}

async function cmdClose() {
  if (!state.port) return { closed: true }
  try {
    await state.browser.send('Browser.close').catch(() => {})
  } catch {
    /* browser already gone */
  }
  for (const tab of state.tabSessions.values()) {
    for (const pending of tab.pending.values()) pending.reject(new Error('closing'))
    tab.pending.clear()
  }
  state.tabSessions.clear()
  state.closed = true
  await sleep(300)
  return { closed: true }
}

function requireChrome() {
  if (!state.port || state.closed) throw new Error('Chrome is not open; call chrome_open first')
}

// ------------------------------------------------------------------- rpc io

const COMMANDS = {
  open: cmdOpen,
  status: cmdStatus,
  newTab: cmdNewTab,
  goto: cmdGoto,
  back: cmdBack,
  forward: cmdForward,
  reload: cmdReload,
  closeTab: cmdCloseTab,
  activate: cmdActivate,
  dom: cmdDom,
  click: cmdClick,
  type: cmdType,
  keypress: cmdKeypress,
  scroll: cmdScroll,
  screenshot: cmdScreenshot,
  eval: cmdEval,
  title: cmdTitle,
  url: cmdUrl,
  close: cmdClose,
}

async function handleLine(line) {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = request
  const command = COMMANDS[method]
  const response = { id }
  if (!command) {
    response.error = { message: `unknown method: ${method}` }
  } else {
    try {
      response.result = await command(params || {})
    } catch (error) {
      response.error = { message: error instanceof Error ? error.message : String(error) }
    }
  }
  process.stdout.write(JSON.stringify(response) + '\n')
}

function startRpc() {
  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    if (!line.trim()) return
    handleLine(line).catch((error) => {
      process.stdout.write(JSON.stringify({
        id: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      }) + '\n')
    })
  })
  rl.on('close', () => {
    state.closed = true
    process.exit(0)
  })
}

// ----------------------------------------------------------------- selftest

async function selftest() {
  const outDir = process.argv[3] || os.tmpdir()
  await mkdir(outDir, { recursive: true }).catch(() => {})
  const results = []
  const record = (name, fn) => fn()
    .then((value) => { results.push({ name, ok: true, value }) })
    .catch((error) => { results.push({ name, ok: false, error: error.message }) })

  await record('open', async () => {
    const opened = await cmdOpen({ url: 'about:blank' })
    if (!opened.port) throw new Error('no port')
    return { port: opened.port, browser: opened.browser, tabs: opened.tabs.length }
  })
  await record('goto', async () => {
    const navigated = await cmdGoto({ url: 'https://example.com' })
    if (!navigated.url.includes('example.com')) throw new Error('wrong url: ' + navigated.url)
    return navigated
  })
  await record('dom', async () => {
    const dom = await cmdDom({})
    if (!dom.count) throw new Error('no elements')
    await writeFile(path.join(outDir, 'dom.json'), JSON.stringify(dom, null, 2))
    return { count: dom.count, url: dom.url, title: dom.title }
  })
  await record('click', async () => {
    const dom = await cmdDom({})
    const link = dom.elements && dom.elements.find((element) => element.tag === 'a' && element.href)
    if (!link) return { clicked: null, note: 'no anchor found to click' }
    await cmdClick({ nodeId: link.nid })
    return { clicked: link.nid, text: link.text }
  })
  await record('screenshot', async () => {
    const shot = await cmdScreenshot({ dir: outDir, name: 'selftest-shot' })
    if (!shot.bytes) throw new Error('empty screenshot')
    return { bytes: shot.bytes, path: shot.path }
  })
  await record('eval', async () => {
    const evaluated = await cmdEval({ expression: '1 + 1' })
    if (!evaluated.ok || evaluated.value !== 2) throw new Error('bad eval')
    return evaluated
  })
  await record('close', cmdClose)

  const summary = { selftest: results }
  const summaryPath = path.join(outDir, 'selftest-results.json')
  await writeFile(summaryPath, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  const failed = results.some((result) => !result.ok)
  process.exit(failed ? 1 : 0)
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  startRpc()
}
