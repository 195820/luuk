import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as nodeFs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as os from 'os'
import { ModelManager } from '../model-manager'
import type { ModelInfo } from '../../../types/plugin'

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

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

describe('P1-8 · ModelManager.verifyModel 防误删 + 大小写归一', () => {
  let tempDir: string
  let manager: ModelManager

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'luuk-model-p18-'))
    manager = new ModelManager(tempDir)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // 约定路径：modelsDir/id
  const filePathOf = (id: string) => path.join(tempDir, id)

  it('sha256 缺失：文件存在 → 仅确认存在性、不删文件、回写 downloaded', async () => {
    const id = 'm-empty-hash'
    await fs.writeFile(filePathOf(id), 'whatever-bytes', 'utf-8')
    manager.registerModel(makeModel({ id, sha256: '', state: 'not-downloaded' }))

    const ok = await manager.verifyModel(id)
    expect(ok).toBe(true)
    // 文件未被误删
    expect(nodeFs.existsSync(filePathOf(id))).toBe(true)
    // 状态回填为 downloaded
    expect(manager.getModelInfo(id)!.state).toBe('downloaded')
  })

  it('sha256 大小写不一致：仍判定成功（统一 toLowerCase 比较）', async () => {
    const id = 'm-case'
    const content = 'payload-xyz'
    await fs.writeFile(filePathOf(id), content, 'utf-8')
    manager.registerModel(makeModel({ id, sha256: sha256(content).toUpperCase(), state: 'not-downloaded' }))

    const ok = await manager.verifyModel(id)
    expect(ok).toBe(true)
    expect(nodeFs.existsSync(filePathOf(id))).toBe(true)
    expect(manager.getModelInfo(id)!.state).toBe('downloaded')
  })

  it('sha256 不匹配：删除损坏文件并返回 false', async () => {
    const id = 'm-bad'
    await fs.writeFile(filePathOf(id), 'actual-bytes', 'utf-8')
    manager.registerModel(makeModel({ id, sha256: sha256('different-expected'), state: 'downloaded' }))

    const ok = await manager.verifyModel(id)
    expect(ok).toBe(false)
    expect(nodeFs.existsSync(filePathOf(id))).toBe(false)
  })

  it('文件缺失：返回 false 且不抛错、不改变状态', async () => {
    const id = 'm-missing'
    manager.registerModel(makeModel({ id, state: 'not-downloaded' }))
    const ok = await manager.verifyModel(id)
    expect(ok).toBe(false)
    expect(manager.getModelInfo(id)!.state).toBe('not-downloaded')
  })
})
