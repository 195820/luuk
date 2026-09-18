/**
 * vitest globalSetup：准备 better-sqlite3 的 Node-ABI 原生二进制，供 DB 集成测试使用。
 *
 * 背景：app 通过 electron-rebuild 把 node_modules/better-sqlite3 的二进制编译成 Electron ABI，
 * vitest 在系统 Node 下加载同一份 .node 会因 NODE_MODULE_VERSION 不匹配崩溃。
 * 方案：单独放置一份 Node-ABI 二进制到 .test-native/better_sqlite3.node，
 * 由 database.ts 通过 nativeBinding（env 注入）显式加载，app 与测试各用各的，互不覆盖。
 *
 * 本脚本幂等：目标存在且能在当前 Node 下加载则跳过；否则用 prebuild-install（走镜像）拉取，
 * 拷贝到 .test-native 后，把 node_modules 内的原二进制原样还原（保持 Electron ABI）。
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const target = path.join(root, '.test-native', 'better_sqlite3.node')
const pkgDir = path.join(root, 'node_modules', 'better-sqlite3')
const pkgBin = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node')
const require = createRequire(import.meta.url)

/** 当前 Node 能否加载给定 .node（ABI 匹配返回 true） */
function loadable(file) {
  try {
    require(file)
    return true
  } catch {
    return false
  }
}

export default function setup() {
  if (!fs.existsSync(pkgDir)) {
    throw new Error(`[ensure-test-native] 未找到 node_modules/better-sqlite3，请先 npm install`)
  }
  // 已是匹配的 Node-ABI 副本则复用
  if (fs.existsSync(target) && loadable(target)) {
    process.env.BETTER_SQLITE3_NATIVE_BINDING = target
    return
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })
  // 备份 node_modules 内的当前二进制（通常是 Electron ABI），结束后原样还原
  const backup = target + '.orig'
  const hadOrig = fs.existsSync(pkgBin)
  if (hadOrig) fs.copyFileSync(pkgBin, backup)

  const mirror =
    process.env.npm_config_better_sqlite3_binary_host_mirror ||
    process.env.BETTER_SQLITE3_BINARY_HOST_MIRROR ||
    'https://registry.npmmirror.com/-/binary/better-sqlite3'

  const bin = path.join(root, 'node_modules', 'prebuild-install', 'bin.js')
  const res = spawnSync(
    process.execPath,
    [bin, '--runtime=node', `--target=${process.versions.node}`, '--arch=' + process.arch, '--platform=' + process.platform],
    { cwd: pkgDir, env: { ...process.env, npm_config_better_sqlite3_binary_host_mirror: mirror }, stdio: 'inherit' },
  )

  let ok = false
  if (res.status === 0 && fs.existsSync(pkgBin)) {
    fs.copyFileSync(pkgBin, target)
    ok = loadable(target)
  }

  // 还原 node_modules 内的原二进制，保证 dev / 打包用的 Electron ABI 不被破坏
  if (hadOrig) {
    fs.copyFileSync(backup, pkgBin)
    fs.rmSync(backup, { force: true })
  }

  if (!ok) {
    throw new Error(
      '[ensure-test-native] 无法获取 Node-ABI 的 better-sqlite3 二进制。\n' +
        `请手动执行：cd node_modules/better-sqlite3 && npx prebuild-install --runtime=node --target=${process.versions.node}，\n` +
        `然后把 build/Release/better_sqlite3.node 复制到 ${target}`,
    )
  }
  process.env.BETTER_SQLITE3_NATIVE_BINDING = target
}
