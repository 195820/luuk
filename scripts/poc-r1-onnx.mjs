/**
 * PoC R1：onnxruntime-node 打包 / 加载验证
 *
 * 目标（对齐计划 Task 0 / 风险 R1）：
 *  1. dev 模式下能否 import('onnxruntime-node') 并创建 InferenceSession
 *  2. 打包后（dist-electron / win-unpacked）native .node 是否随包、能否加载
 *
 * 用法：
 *   node scripts/poc-r1-onnx.mjs                 # 仅做模块 + 会话创建冒烟
 *   node scripts/poc-r1-onnx.mjs --model <path>  # 指定 ONNX 模型做真实 createSession
 *   node scripts/poc-r1-onnx.mjs --check-pack    # 额外扫描 release/win-unpacked 的 .node
 *
 * 退出码：0 = PASS，1 = FAIL（供 CI / 人工判定）
 */

import { createRequire } from 'module'
import * as fs from 'fs'
import * as path from 'path'

const require = createRequire(import.meta.url)

function arg(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (flag) => process.argv.includes(flag)

let pass = 0
let fail = 0
function ok(msg) {
  pass++
  console.log(`  \x1b[32m✔\x1b[0m ${msg}`)
}
function bad(msg, err) {
  fail++
  console.log(`  \x1b[31m✘\x1b[0m ${msg}`)
  if (err) console.log(`      ${err.message}`)
}

async function step1LoadModule() {
  console.log('[R1.1] 加载 onnxruntime-node 模块')
  try {
    const ort = require('onnxruntime-node')
    if (!ort?.InferenceSession) throw new Error('未导出 InferenceSession')
    ok(`onnxruntime-node 已加载，版本探测: ${ort.VERSION ?? 'unknown'}`)
    return ort
  } catch (err) {
    bad('无法加载 onnxruntime-node（native 绑定缺失或 ABI 错配）', err)
    return null
  }
}

async function step2AvailableProviders(ort) {
  console.log('[R1.2] Execution Provider 可用性')
  try {
    const eps = await ort.Env?.availableProviders?.()
    if (eps) {
      ok(`availableProviders = ${JSON.stringify(eps)}`)
    } else {
      ok('Env.availableProviders 不可用（新版 runtime），跳过枚举')
    }
  } catch (err) {
    bad('枚举 EP 失败', err)
  }
}

async function step3CreateSession(ort) {
  console.log('[R1.3] 创建 InferenceSession')
  const modelPath = arg('--model')
  if (!modelPath) {
    console.log('  \x1b[33m○\x1b[0m 未提供 --model，跳过真实 createSession（可 --model <path> 补充）')
    return
  }
  if (!fs.existsSync(modelPath)) {
    bad(`模型文件不存在: ${modelPath}`)
    return
  }
  for (const ep of ['cpu']) {
    try {
      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: [ep],
        graphOptimizationLevel: 'all',
      })
      ok(`EP=${ep} createSession 成功，输入: ${session.inputNames.join(', ')}`)
      try {
        session.release && session.release()
      } catch {
        /* ignore */
      }
    } catch (err) {
      bad(`EP=${ep} createSession 失败`, err)
    }
  }
}

function step4CheckPack() {
  if (!has('--check-pack')) return
  console.log('[R1.4] 打包产物 native 扫描 (release/win-unpacked)')
  const roots = [
    path.resolve('release', 'win-unpacked', 'resources'),
    path.resolve('release-new', 'win-unpacked', 'resources'),
  ]
  const dir = roots.find((r) => fs.existsSync(r))
  if (!dir) {
    console.log('  \x1b[33m○\x1b[0m 未找到 win-unpacked/resources，先运行 npm run build:dir')
    return
  }
  const found = []
  walk(dir, (f) => {
    if (f.endsWith('.node')) found.push(f)
  })
  const onnx = found.filter((f) => /onnxruntime/i.test(f))
  if (onnx.length) {
    ok(`发现 ${onnx.length} 个 onnxruntime .node：\n      ${onnx.slice(0, 5).join('\n      ')}`)
  } else {
    bad('打包产物中未发现 onnxruntime .node，检查 asarUnpack 配置')
  }
  const unpacked = path.join(dir, 'app.asar.unpacked')
  if (fs.existsSync(unpacked)) {
    ok('app.asar.unpacked 存在（asarUnpack 生效）')
  } else {
    console.log('  \x1b[33m○\x1b[0m 无 app.asar.unpacked（若 .node 均在 asar 内可能加载失败）')
  }
}

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, cb)
    else cb(full)
  }
}

async function main() {
  console.log('=== PoC R1: onnxruntime-node 打包/加载验证 ===')
  const ort = await step1LoadModule()
  if (ort) {
    await step2AvailableProviders(ort)
    await step3CreateSession(ort)
  }
  step4CheckPack()
  console.log(`\n结果: ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('[R1] 未捕获异常:', err)
  process.exit(1)
})
