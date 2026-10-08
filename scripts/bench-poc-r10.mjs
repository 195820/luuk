// R10 PoC 驱动：@mtcute/node 在 Node 24 与 Electron 40 utilityProcess 双通道的
// crypto / ESM 装载 / TCP 长连接可用性（方向文档计划增补项 R10）
// Prereq：npm i @mtcute/node@0.32.3 --no-save
// 用法：node scripts/bench-poc-r10.mjs
import { createRequire } from 'module'
import path from 'path'
import { execFileSync } from 'child_process'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(import.meta.dirname, '..')
const DIR = path.join(ROOT, 'scripts', 'poc-r10')

const parse = (stdout) => {
  const line = stdout.split('\n').find((l) => l.startsWith('POC_JSON='))
  return line ? JSON.parse(line.slice(9)) : { error: 'no POC_JSON in output: ' + stdout.slice(0, 200) }
}

// 通道 1：Node 24 直跑
let nodeRes
try {
  nodeRes = parse(execFileSync(process.execPath, [path.join(DIR, 'worker.mjs')], { encoding: 'utf8', env: { ...process.env, LUUK_POC_CHANNEL: 'node' }, timeout: 60_000 }))
} catch (e) { nodeRes = { error: String(e.stdout || e.message).slice(0, 300) } }
console.log('node           :', JSON.stringify(nodeRes))

// 通道 2：Electron 40 utilityProcess
let utilRes
try {
  const electronBin = require('electron') // 路径指向 electron.exe
  utilRes = parse(execFileSync(electronBin, [path.join(DIR, 'electron-main.cjs')], { encoding: 'utf8', timeout: 90_000 }))
} catch (e) { utilRes = { error: String(e.stdout || e.message).slice(0, 300) } }
console.log('utilityProcess :', JSON.stringify(utilRes))

console.log('===JSON===')
console.log(JSON.stringify({ node: nodeRes, utilityProcess: utilRes }, null, 1))
