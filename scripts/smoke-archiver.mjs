/**
 * archiver 冒烟测试脚本
 * 验证 Electron 主进程中 archiver 可正常工作（dev + build:dir）
 *
 * 执行方式：
 *   dev: node scripts/smoke-archiver.mjs
 *   build: 打包后在 release/win-unpacked/resources/app.asar.unpacked/scripts/ 中执行
 */

import { createWriteStream, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import archiver from 'archiver'

const TEST_DIR = join(tmpdir(), 'archiver-smoke-test')
const OUTPUT_PATH = join(TEST_DIR, 'test.zip')

async function smokeTest() {
  console.log('[Archiver Smoke Test] 开始测试...')
  console.log(`[Archiver Smoke Test] 测试目录: ${TEST_DIR}`)
  console.log(`[Archiver Smoke Test] 输出文件: ${OUTPUT_PATH}`)

  // 清理并创建测试目录
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
  mkdirSync(TEST_DIR, { recursive: true })

  try {
    // 创建 ZIP 文件
    const output = createWriteStream(OUTPUT_PATH)
    const archive = archiver('zip', { zlib: { level: 6 } })

    // 监听事件
    output.on('close', () => {
      console.log(`[Archiver Smoke Test] ✅ ZIP 创建成功: ${archive.pointer()} 字节`)
      console.log('[Archiver Smoke Test] 测试通过')
    })

    archive.on('error', (err) => {
      console.error('[Archiver Smoke Test] ❌ 测试失败:', err)
      process.exit(1)
    })

    archive.pipe(output)

    // 添加测试文件
    archive.append('Hello from archiver smoke test!', { name: 'test.txt' })
    archive.append(JSON.stringify({ test: true, timestamp: Date.now() }), { name: 'data.json' })

    // 完成归档
    await archive.finalize()

    // 等待输出流关闭
    await new Promise((resolve) => output.on('close', resolve))

    console.log('[Archiver Smoke Test] ✅ 所有测试通过')
  } catch (err) {
    console.error('[Archiver Smoke Test] ❌ 异常:', err)
    process.exit(1)
  }
}

smokeTest()
