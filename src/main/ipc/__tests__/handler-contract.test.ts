// @vitest-environment node
/**
 * IPC 契约测试（静态扫描，node env，零副作用）。
 * 不 import handler 代码（避免 getMasterDB()/libraryMonitor.start() 真实副作用），
 * 仅用 fs+regex 解析源文件中的 channel 字符串，断言四类拓扑一致性。
 *
 * 四类断言：
 * 1. preload invoke ↔ ipcMain.handle
 * 2. preload send ↔ ipcMain.on
 * 3. preload on* 订阅 ↔ 主进程广播（sendToRenderer / webContents.send）
 * 4. 注册/注销集合对称
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ==================== 源文件路径 ====================
const ROOT = path.resolve(__dirname, '../../../..')
const PRELOAD_PATH = path.join(ROOT, 'electron/preload.ts')
const MAIN_PATH = path.join(ROOT, 'electron/main.ts')
const IPC_DIR = path.join(ROOT, 'src/main/ipc')
const IPC_FILES = fs.readdirSync(IPC_DIR).filter(f => f.endsWith('.ts') && !f.includes('__tests__'))

// ==================== 辅助函数 ====================
function readFile(p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

/** 从 preload.ts 提取所有 ipcRenderer.invoke('channel'...) 中的 channel */
function extractPreloadInvokeChannels(src: string): string[] {
  const matches = [...src.matchAll(/ipcRenderer\.invoke\(\s*['"`]([^'"`]+)['"`]/g)]
  return [...new Set(matches.map(m => m[1]))]
}

/** 从 preload.ts 提取所有 ipcRenderer.send('channel'...) 中的 channel */
function extractPreloadSendChannels(src: string): string[] {
  const matches = [...src.matchAll(/ipcRenderer\.send\(\s*['"`]([^'"`]+)['"`]/g)]
  return [...new Set(matches.map(m => m[1]))]
}

/** 从 preload.ts 提取所有 ipcRenderer.on('channel'...) 中的 channel（on* 订阅模式） */
function extractPreloadOnChannels(src: string): string[] {
  const matches = [...src.matchAll(/ipcRenderer\.on\(\s*['"`]([^'"`]+)['"`]/g)]
  return [...new Set(matches.map(m => m[1]))]
}

/** 从源文件集提取所有 ipcMain.handle('channel'...) */
function extractHandleChannels(sources: string[]): string[] {
  const channels: string[] = []
  for (const src of sources) {
    const matches = [...src.matchAll(/ipcMain\.handle\(\s*['"`]([^'"`]+)['"`]/g)]
    channels.push(...matches.map(m => m[1]))
  }
  return [...new Set(channels)]
}

/** 从源文件集提取所有 ipcMain.on('channel'...) */
function extractOnChannels(sources: string[]): string[] {
  const channels: string[] = []
  for (const src of sources) {
    const matches = [...src.matchAll(/ipcMain\.on\(\s*['"`]([^'"`]+)['"`]/g)]
    channels.push(...matches.map(m => m[1]))
  }
  return [...new Set(channels)]
}

/** 从主进程源文件提取所有 sendToRenderer('channel'...) + webContents.send('channel'...) */
function extractBroadcastChannels(): string[] {
  const channels: string[] = []
  // 搜索 src/main/** 和 electron/main.ts
  const searchDirs = [
    path.join(ROOT, 'src/main/ipc'),
    path.join(ROOT, 'src/main/services'),
    path.join(ROOT, 'src/main/utils'),
  ]
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'))
    for (const f of files) {
      const src = readFile(path.join(dir, f))
      const m1 = [...src.matchAll(/sendToRenderer\(\s*['"`]([^'"`]+)['"`]/g)]
      const m2 = [...src.matchAll(/webContents\.send\(\s*['"`]([^'"`]+)['"`]/g)]
      channels.push(...m1.map(m => m[1]), ...m2.map(m => m[1]))
    }
  }
  // electron/main.ts 也可能有 webContents.send
  const mainSrc = readFile(MAIN_PATH)
  const m3 = [...mainSrc.matchAll(/webContents\.send\(\s*['"`]([^'"`]+)['"`]/g)]
  channels.push(...m3.map(m => m[1]))
  return [...new Set(channels)]
}

/** 从 handler 文件提取注册/注销集合对称性（命名数组） */
function extractRegisterUnregisterSymmetry(): Array<{
  file: string
  registered: string[]
  unregistered: string[]
  missing: string[]
}> {
  const results: Array<{ file: string; registered: string[]; unregistered: string[]; missing: string[] }> = []

  for (const f of IPC_FILES) {
    const src = readFile(path.join(IPC_DIR, f))
    // 查找 HANDLER_NAMES 或 channels 数组（用于注销）
    const namesArrayMatch = src.matchAll(
      /(?:const\s+\w+(?:_HANDLER_NAMES|_NAMES)\s*=\s*\[([\s\S]*?)\]\s*as\s+const|const\s+channels\s*=\s*\[([\s\S]*?)\])/g
    )
    // 查找所有 handle 注册
    const registered = [...src.matchAll(/ipcMain\.handle\(\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1])

    for (const match of namesArrayMatch) {
      const arrayContent = match[1] || match[2] || ''
      const unregistered = [...arrayContent.matchAll(/['"`]([^'"`]+)['"`]/g)].map(m => m[1])
      // 找出注册了但没在注销数组中的（排除内联数组场景）
      const missing = registered.filter(ch => !unregistered.includes(ch))
      if (missing.length > 0 || unregistered.length > 0) {
        results.push({ file: f, registered, unregistered, missing })
      }
    }
  }
  return results
}

// ==================== 白名单 ====================
/**
 * 已知半死通道（有 handle 无 preload invoke）：
 * - updateScanProgress / clearScanProgress：主进程内部转发扫描进度，不暴露给渲染进程。
 * 如后续删除或 preload 暴露，移除此白名单即可。
 */
const HALF_DEAD_HANDLES = ['updateScanProgress', 'clearScanProgress']

// ==================== 测试 ====================
describe('IPC 契约（静态扫描）', () => {
  const preloadSrc = readFile(PRELOAD_PATH)
  const mainSrc = readFile(MAIN_PATH)
  const ipcSources = IPC_FILES.map(f => readFile(path.join(IPC_DIR, f)))

  const preloadInvokes = extractPreloadInvokeChannels(preloadSrc)
  const preloadSends = extractPreloadSendChannels(preloadSrc)
  const preloadOns = extractPreloadOnChannels(preloadSrc)

  const allHandleSources = [...ipcSources, mainSrc]
  const handleChannels = extractHandleChannels(allHandleSources)
  const onChannels = extractOnChannels([mainSrc]) // ipcMain.on 仅在 main.ts

  describe('类别 1: preload invoke ↔ ipcMain.handle', () => {
    it(`preload invoke 通道数 ≥ 100（当前 ${preloadInvokes.length}）`, () => {
      expect(preloadInvokes.length).toBeGreaterThanOrEqual(100)
    })

    it('每个 preload invoke 通道都有对应的 ipcMain.handle', () => {
      const handleSet = new Set(handleChannels)
      const orphans = preloadInvokes.filter(ch => !handleSet.has(ch))
      expect(orphans, `孤立 invoke 通道: ${orphans.join(', ')}`).toEqual([])
    })

    it('ipcMain.handle 中无 preload invoke 的通道仅白名单项', () => {
      const invokeSet = new Set(preloadInvokes)
      const extraHandles = handleChannels.filter(ch => !invokeSet.has(ch))
      expect(extraHandles.sort()).toEqual(HALF_DEAD_HANDLES.sort())
    })
  })

  describe('类别 2: preload send ↔ ipcMain.on', () => {
    it('preload send 通道为 4 个窗口控制', () => {
      expect(preloadSends.sort()).toEqual([
        'window-close', 'window-maximize', 'window-minimize', 'window-toggle-fullscreen',
      ])
    })

    it('每个 preload send 都有对应的 ipcMain.on', () => {
      const onSet = new Set(onChannels)
      const orphans = preloadSends.filter(ch => !onSet.has(ch))
      expect(orphans, `孤立 send 通道: ${orphans.join(', ')}`).toEqual([])
    })

    it('ipcMain.on 无多余通道（与 send 完全对称）', () => {
      const sendSet = new Set(preloadSends)
      const extra = onChannels.filter(ch => !sendSet.has(ch))
      expect(extra, `多余 ipcMain.on: ${extra.join(', ')}`).toEqual([])
    })
  })

  describe('类别 3: preload on* 订阅 ↔ 主进程广播', () => {
    const broadcastChannels = extractBroadcastChannels()

    it(`preload on* 订阅通道数 = 9（当前 ${preloadOns.length}）`, () => {
      expect(preloadOns.length).toBe(9)
    })

    it('每个 preload ipcRenderer.on 通道都有主进程广播源', () => {
      const broadcastSet = new Set(broadcastChannels)
      // fullscreen-changed 是特殊通道：通过 webContents.send 在 main.ts 发出
      const orphans = preloadOns.filter(ch => !broadcastSet.has(ch))
      expect(orphans, `无广播源的订阅: ${orphans.join(', ')}`).toEqual([])
    })
  })

  describe('类别 4: 注册/注销集合对称', () => {
    const symmetryResults = extractRegisterUnregisterSymmetry()

    it('每个 handler 文件的 handle 注册都在注销数组中（或无注销数组则跳过）', () => {
      // 只检查有显式 NAMES 数组的文件
      const issues: string[] = []
      for (const r of symmetryResults) {
        // 如果 missing 中的 channel 属于 main.ts 级别或在 HALF_DEAD_HANDLES 则允许
        const realMissing = r.missing.filter(ch => !HALF_DEAD_HANDLES.includes(ch))
        if (realMissing.length > 0) {
          issues.push(`${r.file}: 注册未注销 [${realMissing.join(', ')}]`)
        }
      }
      expect(issues, issues.join('\n')).toEqual([])
    })

    it('library-handlers IPC_HANDLER_NAMES 包含全部 handle（含半死通道）', () => {
      const libSrc = readFile(path.join(IPC_DIR, 'library-handlers.ts'))
      const namesMatch = libSrc.match(/const\s+IPC_HANDLER_NAMES\s*=\s*\[([\s\S]*?)\]\s*as\s+const/)
      expect(namesMatch).not.toBeNull()
      const namesContent = namesMatch![1]
      const names = [...namesContent.matchAll(/['"`]([^'"`]+)['"`]/g)].map(m => m[1])
      // 从 source 提取所有实际注册的 handle channel
      const handles = [...libSrc.matchAll(/ipcMain\.handle\(\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1])
      const missing = handles.filter(ch => !names.includes(ch))
      expect(missing, `未列入注销数组: ${missing.join(', ')}`).toEqual([])
    })

    it('file-handlers FILE_IPC_HANDLER_NAMES 与 handle 数量一致', () => {
      const fileSrc = readFile(path.join(IPC_DIR, 'file-handlers.ts'))
      const handles = [...fileSrc.matchAll(/ipcMain\.handle\(\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1])
      const namesMatch = fileSrc.match(/const\s+FILE_IPC_HANDLER_NAMES\s*=\s*\[([\s\S]*?)\]\s*as\s+const/)
      expect(namesMatch).not.toBeNull()
      const names = [...namesMatch![1].matchAll(/['"`]([^'"`]+)['"`]/g)].map(m => m[1])
      expect(names.sort()).toEqual(handles.sort())
    })
  })

  describe('总量锚定', () => {
    it('preload 总键数 = invoke(102) + send(4) + on*(9) = 115', () => {
      const total = preloadInvokes.length + preloadSends.length + preloadOns.length
      expect(total).toBe(115)
    })

    it('ipcMain.handle 总数 = 104（含半死通道 2 个 + main.ts 4 个）', () => {
      // 注：如果后续增删 handle，只需更新此数字并保证四类断言通过
      expect(handleChannels.length).toBe(104)
    })
  })
})
