/**
 * 编译内置插件（builtins）
 *
 * 问题：autotone/matting/upscale 的 plugin.json 声明 entry: "index.js"，
 * 但仓库只有 index.ts。PluginLoader 用 fs.access(entryPath) 校验入口存在，
 * 未编译则判 invalid。此脚本用 esbuild 将每个内置插件编译为 CJS，并复制
 * plugin.json 到 dist-electron/plugins/builtins/<name>/，供 Worker require() 加载。
 *
 * 用法：
 *   node scripts/build-builtins.mjs          # 单次构建
 *   node scripts/build-builtins.mjs --watch   # 开发监听
 */

import { build, context } from 'esbuild'
import * as fs from 'fs'
import * as path from 'path'

const SRC_DIR = path.resolve('src/main/plugins/builtins')
const OUT_DIR = path.resolve('dist-electron/plugins/builtins')

function listPluginDirs() {
  if (!fs.existsSync(SRC_DIR)) return []
  return fs
    .readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => fs.existsSync(path.join(SRC_DIR, d.name, 'index.ts')))
    .map((d) => d.name)
}

/** 复制 plugin.json（及可选资源）到产物目录 */
function copyManifests() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  // 根 package.json 为 "type": "module"；builtins 产物是 CJS（format:'cjs'）。
  // 在其产物目录写入 {"type":"commonjs"} 边界，确保 plugin-worker 的 require() 正确按 CJS 加载。
  const boundary = path.join(OUT_DIR, 'package.json')
  fs.writeFileSync(boundary, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')
  for (const name of listPluginDirs()) {
    const srcManifest = path.join(SRC_DIR, name, 'plugin.json')
    const dstManifest = path.join(OUT_DIR, name, 'plugin.json')
    if (fs.existsSync(srcManifest)) {
      fs.mkdirSync(path.dirname(dstManifest), { recursive: true })
      fs.copyFileSync(srcManifest, dstManifest)
    }
  }
}

const entryPoints = listPluginDirs().map((name) =>
  path.join(SRC_DIR, name, 'index.ts'),
)

const commonOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs', // plugin-worker 通过 require() 加载
  external: ['sharp', 'onnxruntime-node'],
  sourcemap: true,
  target: 'node20',
  logLevel: 'info',
}

async function run() {
  copyManifests()
  if (entryPoints.length === 0) {
    console.log('[build-builtins] 未发现内置插件，跳过')
    return
  }

  if (process.argv.includes('--watch')) {
    const ctx = await context({
      ...commonOptions,
      entryPoints,
      outbase: SRC_DIR,
      outdir: OUT_DIR,
      // 用 outbase 让产物落在 <outdir>/<pluginName>/index.js
    })
    await ctx.watch()
    console.log('[build-builtins] watch 模式已启动')
  } else {
    await build({
      ...commonOptions,
      entryPoints,
      outbase: SRC_DIR,
      outdir: OUT_DIR,
    })
    console.log('[build-builtins] 构建完成')
  }
}

run().catch((err) => {
  console.error('[build-builtins] 构建失败:', err)
  process.exit(1)
})
