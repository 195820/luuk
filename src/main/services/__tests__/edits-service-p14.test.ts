import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EditsService } from '../edits-service'

describe('P1-4 · EditsService 输出路径库根内二次校验', () => {
  let libRoot: string
  let foreign: string
  let createEditSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-edit-lib-'))
    foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'luuk-edit-foreign-'))
    createEditSpy = vi.fn(() => 42)
  })

  const mkSvc = () =>
    new EditsService({
      getLibrary: (id: number) => (id === 1 ? { rootPath: libRoot } : null),
      createEdit: createEditSpy,
    } as any)

  it('sourcePath 在库内：输出落 _edits 且写库成功', async () => {
    const src = path.join(libRoot, 'a.jpg')
    fs.writeFileSync(src, 'x')
    const editId = await mkSvc().createEdit(1, 10, src, 'builtin.autotone', 'autotone', Buffer.from([1]))
    expect(editId).toBe(42)
    expect(createEditSpy).toHaveBeenCalledTimes(1)
    const rec = createEditSpy.mock.calls[0][0]
    expect(String(rec.outputPath).toLowerCase()).toContain(path.join('_edits').toLowerCase())
  })

  it('sourcePath 越出库根：抛越权且不落库', async () => {
    const src = path.join(foreign, 'evil.jpg')
    fs.writeFileSync(src, 'x')
    await expect(
      mkSvc().createEdit(1, 10, src, 'builtin.evil', 'evil', Buffer.from([1])),
    ).rejects.toThrow(/越权/)
    expect(createEditSpy).not.toHaveBeenCalled()
  })

  it('libraryId 不存在：拒绝写入', async () => {
    const src = path.join(libRoot, 'b.jpg')
    await expect(
      mkSvc().createEdit(999, 10, src, 'builtin.x', 'x', Buffer.from([1])),
    ).rejects.toThrow(/库不存在/)
  })
})
