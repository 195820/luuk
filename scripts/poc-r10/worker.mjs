// R10 PoC worker：在子进程（Node 或 Electron utilityProcess）内验证 @mtcute/node
// Prereq：npm i @mtcute/node@0.32.3 --no-save
// 测试项：1) ESM 装载 2) webcrypto/PRNG 可用性 3) mtcute 核心类装载面 4) TCP 长连接（本地回环 + 真实 TG DC）
// 结果以 POC_JSON= 前缀输出
import net from 'net'

const out = { channel: process.env.LUUK_POC_CHANNEL || 'node' }
out.electronRuntime = !!(process.versions && process.versions.electron)

function tcpConnect(host, port, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const s = net.createConnection({ host, port })
    let settled = false
    let connected = false
    let got = false
    const done = (r) => { if (!settled) { settled = true; resolve(r) } } // 单一裁决闸门，多事件竞争时只取首个
    s.setTimeout(timeoutMs)
    s.on('connect', () => {
      connected = true
      s.write(Buffer.from([0xef, 0xef, 0xef, 0xef])) // MTPL 协议无效字节，仅测 TCP+RW；对方大概率直接断开/不回，均视为可达
      s.once('data', () => { got = true })
      setTimeout(() => { if (!s.destroyed) s.destroy(); done({ ok: true, ms: Date.now() - t0, echoOrPeer: got, note: 'connected-no-response' }) }, 2500)
    })
    s.on('timeout', () => { s.destroy(); done({ ok: false, ms: Date.now() - t0, note: 'timeout' }) })
    s.on('error', (e) => { done({ ok: connected, ms: Date.now() - t0, note: connected ? String(e.code || e.message).slice(0, 60) : 'connect-failed: ' + String(e.code || e.message).slice(0, 60) }) })
    s.on('close', () => done({ ok: connected, ms: Date.now() - t0, echoOrPeer: got }))
  })
}

try {
  // 1) mtcute 装载
  const t0 = Date.now()
  const mtcute = await import('@mtcute/node')
  out.mtcuteImportMs = Date.now() - t0
  out.mtcuteVersion = mtcute.VERSION || mtcute.version || 'unknown'

  // 2) webcrypto / PRNG
  out.webcrypto = !!(globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.getRandomValues)
  const key = await globalThis.crypto.subtle.generateKey({ name: 'AES-CBC', length: 256 }, false, ['encrypt', 'decrypt'])
  const enc = await globalThis.crypto.subtle.encrypt({ name: 'AES-CBC', iv: globalThis.crypto.getRandomValues(new Uint8Array(16)) }, key, new Uint8Array(32))
  out.subtleAesOk = enc.byteLength === 48

  // 3) mtcute 核心类可用性（不 start，仅验证装载面）
  out.TelegramClientType = typeof mtcute.TelegramClient
  try {
    const storage = await import('@mtcute/core/storage.js')
    out.mtcuteStorageKeys = Object.keys(storage).slice(0, 8)
  } catch (e) { out.mtcuteStorageImport = 'FAIL ' + String(e.message).slice(0, 80) }

  // 4a) 自包含 TCP 回环（验证本进程 net 模块：监听+连接+收发，mtcute 传输层的硬依赖）
  out.localTcpLoopback = await new Promise((resolve) => {
    const srv = net.createServer((s) => s.on('data', (d) => { if (d.toString() === 'ping') { s.write('pong'); setTimeout(() => s.end(), 50) } }))
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port
      const c = net.createConnection({ host: '127.0.0.1', port: p })
      const t = Date.now()
      c.on('connect', () => c.write('ping'))
      c.once('data', (d) => { resolve({ ok: d.toString() === 'pong', ms: Date.now() - t }); c.destroy(); srv.close() })
      c.on('error', (e) => { resolve({ ok: false, err: String(e.message) }); srv.close() })
      setTimeout(() => { resolve({ ok: false, err: 'timeout' }); srv.close() }, 5000)
    })
  })

  // 4b) 真实 TG DC TCP 可达性（地址可经 env 覆盖，便于代理/专网环境复验）
  out.tgDc = await tcpConnect(process.env.LUUK_POC_TG_DC_HOST || '149.154.167.51', +(process.env.LUUK_POC_TG_DC_PORT || 443)) // 默认 DC1
} catch (e) {
  out.error = String(e && e.stack || e).slice(0, 500)
}
await new Promise((r) => process.stdout.write('POC_JSON=' + JSON.stringify(out) + '\n', r)) // 等管道 drain，防截断
process.exit(out.error ? 1 : 0)
