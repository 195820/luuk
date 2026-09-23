// CDP 求值探针：向正在运行的应用主窗口发送 JS 表达式并打印结果
// 用法: node scripts/cdp-eval.mjs "<js expression>"   (需应用以 remote-debugging-port=9222 运行)
// 示例: node scripts/cdp-eval.mjs "await window.electronAPI.pluginsList()"
const expr = process.argv[2]
if (!expr) {
  console.error('用法: node scripts/cdp-eval.mjs "<js expression>"')
  process.exit(1)
}
const PORT = process.env.CDP_PORT || '9222'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t => t.type === 'page' && /localhost:\d+/.test(t.url) && !t.url.includes('devtools'))
if (!page) {
  console.error('未找到应用主窗口 target，请确认应用已启动且开启 9222 调试端口')
  console.error('现有 targets:', targets.map(t => `${t.type} ${t.url}`).join('\n'))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})

const expression = `(async () => { try { const r = await (${expr}); return JSON.stringify(r === undefined ? '<undefined>' : r, null, 2) } catch (e) { return 'EVAL_ERROR: ' + String((e && e.message) || e) } })()`
const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
if (res.error) {
  console.error('CDP 错误:', JSON.stringify(res.error))
} else {
  console.log(res.result?.result?.value ?? JSON.stringify(res.result))
}
ws.close()
process.exit(0)
