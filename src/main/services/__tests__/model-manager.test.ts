import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import * as os from 'os'
import { ModelManager } from '../model-manager'
import type { ModelInfo } from '../../../types/plugin'

/** 构造临时目录，每个测试用例独立 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'model-manager-test-'))
}

/** 递归删除临时目录 */
async function removeTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

/** 写入指定内容的文件 */
async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

/** 计算字符串的 SHA256 hex */
function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/** 构造一个基础 ModelInfo */
function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'test-model',
    name: 'Test Model',
    size: 1024,
    sha256: sha256('test-content'),
    state: 'not-downloaded',
    ...overrides,
  }
}

describe('ModelManager', () => {
  let tempDir: string
  let manager: ModelManager

  beforeEach(async () => {
    tempDir = await createTempDir()
    manager = new ModelManager(tempDir)
  })

  afterEach(async () => {
    await removeTempDir(tempDir)
  })

  describe('registerModel', () => {
    it('注册模型后可通过 getModelInfo 查询', () => {
      const model = makeModel()
      manager.registerModel(model)
      const info = manager.getModelInfo(model.id)
      expect(info).toBeDefined()
      expect(info!.id).toBe(model.id)
      expect(info!.name).toBe(model.name)
    })

    it('注册多个模型', () => {
      manager.registerModel(makeModel({ id: 'model-a', name: 'A' }))
      manager.registerModel(makeModel({ id: 'model-b', name: 'B' }))
      expect(manager.listModels()).toHaveLength(2)
    })

    it('同 id 重复注册会覆盖', () => {
      manager.registerModel(makeModel({ id: 'm1', name: 'old' }))
      manager.registerModel(makeModel({ id: 'm1', name: 'new' }))
      expect(manager.getModelInfo('m1')!.name).toBe('new')
      expect(manager.listModels()).toHaveLength(1)
    })
  })

  describe('getModelInfo', () => {
    it('未注册的模型返回 undefined', () => {
      expect(manager.getModelInfo('non-existent')).toBeUndefined()
    })

    it('返回未下载状态的模型信息', () => {
      const model = makeModel({ state: 'not-downloaded' })
      manager.registerModel(model)
      const info = manager.getModelInfo(model.id)!
      expect(info.state).toBe('not-downloaded')
      expect(info.localPath).toBeUndefined()
      expect(info.progress).toBeUndefined()
    })

    it('返回的是副本，外部修改不影响内部状态', () => {
      manager.registerModel(makeModel({ id: 'x' }))
      const info = manager.getModelInfo('x')!
      info.name = 'hacked'
      expect(manager.getModelInfo('x')!.name).toBe('Test Model')
    })
  })

  describe('listModels', () => {
    it('空注册表返回空数组', () => {
      expect(manager.listModels()).toEqual([])
    })

    it('返回所有已注册模型', () => {
      manager.registerModel(makeModel({ id: 'a' }))
      manager.registerModel(makeModel({ id: 'b' }))
      manager.registerModel(makeModel({ id: 'c' }))
      const list = manager.listModels()
      expect(list).toHaveLength(3)
      expect(list.map(m => m.id).sort()).toEqual(['a', 'b', 'c'])
    })

    it('返回的是副本数组，外部修改不影响内部', () => {
      manager.registerModel(makeModel({ id: 'y' }))
      const list = manager.listModels()
      list[0].name = 'hacked'
      expect(manager.getModelInfo('y')!.name).toBe('Test Model')
    })
  })

  describe('getModelPath', () => {
    it('未注册模型返回 null', () => {
      expect(manager.getModelPath('ghost')).toBeNull()
    })

    it('已注册但未下载时返回约定路径（modelsDir/id）', () => {
      manager.registerModel(makeModel({ id: 'model.bin' }))
      expect(manager.getModelPath('model.bin')).toBe(path.join(tempDir, 'model.bin'))
    })

    it('已下载模型返回记录的 localPath', () => {
      const customPath = path.join(tempDir, 'custom', 'model.bin')
      manager.registerModel(makeModel({ id: 'm1' }))
      manager.markDownloaded('m1', customPath)
      expect(manager.getModelPath('m1')).toBe(customPath)
    })
  })

  describe('verifyModel', () => {
    it('未注册模型返回 false', async () => {
      expect(await manager.verifyModel('ghost')).toBe(false)
    })

    it('文件不存在返回 false', async () => {
      manager.registerModel(makeModel({ id: 'missing.bin' }))
      expect(await manager.verifyModel('missing.bin')).toBe(false)
    })

    it('SHA256 匹配时返回 true', async () => {
      const content = 'valid-model-content'
      const hash = sha256(content)
      const filePath = path.join(tempDir, 'valid.bin')
      await writeFile(filePath, content)

      manager.registerModel(makeModel({ id: 'valid', sha256: hash }))
      manager.markDownloaded('valid', filePath)

      expect(await manager.verifyModel('valid')).toBe(true)
      // 校验通过后文件仍存在
      await expect(fs.access(filePath)).resolves.toBeUndefined()
    })

    it('SHA256 不匹配时返回 false 并删除文件', async () => {
      const content = 'corrupted-content'
      const filePath = path.join(tempDir, 'corrupt.bin')
      await writeFile(filePath, content)

      // 注册一个 hash 与实际内容不匹配的模型
      manager.registerModel(makeModel({ id: 'corrupt', sha256: sha256('expected-content') }))
      manager.markDownloaded('corrupt', filePath)

      expect(await manager.verifyModel('corrupt')).toBe(false)
      // 校验失败后文件应被删除
      await expect(fs.access(filePath)).rejects.toThrow()
    })
  })

  describe('updateProgress', () => {
    it('更新进度并切换状态为 downloading', () => {
      manager.registerModel(makeModel({ id: 'dl' }))
      manager.updateProgress('dl', 42)
      const info = manager.getModelInfo('dl')!
      expect(info.progress).toBe(42)
      expect(info.state).toBe('downloading')
    })

    it('进度值限制在 0-100 范围内', () => {
      manager.registerModel(makeModel({ id: 'p' }))
      manager.updateProgress('p', -10)
      expect(manager.getModelInfo('p')!.progress).toBe(0)
      manager.updateProgress('p', 200)
      expect(manager.getModelInfo('p')!.progress).toBe(100)
    })

    it('未注册模型不抛错', () => {
      expect(() => manager.updateProgress('nope', 50)).not.toThrow()
    })
  })

  describe('markDownloaded', () => {
    it('标记为 downloaded 并记录路径', () => {
      manager.registerModel(makeModel({ id: 'done' }))
      manager.markDownloaded('done', '/path/to/model.bin')
      const info = manager.getModelInfo('done')!
      expect(info.state).toBe('downloaded')
      expect(info.localPath).toBe('/path/to/model.bin')
      expect(info.progress).toBe(100)
    })

    it('未注册模型不抛错', () => {
      expect(() => manager.markDownloaded('nope', '/x')).not.toThrow()
    })
  })

  describe('markFailed', () => {
    it('标记为 failed', () => {
      manager.registerModel(makeModel({ id: 'f' }))
      manager.markFailed('f')
      expect(manager.getModelInfo('f')!.state).toBe('failed')
    })

    it('未注册模型不抛错', () => {
      expect(() => manager.markFailed('nope')).not.toThrow()
    })
  })
})
