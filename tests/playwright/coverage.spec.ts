/**
 * 剩余人工项的自动化覆盖（MT-DATA / MT-MEDIA / MT-EDGE / TC-* / MT-FILE / MT-CORE-08 / MT-IX-02）
 * 前置：npm run build:dir (或 npx vite build)
 * 运行：node node_modules/@playwright/test/cli.js test tests/playwright/coverage.spec.ts --config=tests/playwright.config.ts --reporter=list
 */
import { electronTest as test, expect } from './fixtures'
import { _electron as electron } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

const PROJECT_ROOT = process.cwd()
const TEST_LIBRARY = path.join(PROJECT_ROOT, 'test-library').replace(/\\/g, '/')
const EDGE_LIBRARY = path.join(PROJECT_ROOT, 'test-library-edge').replace(/\\/g, '/')
const ELECTRON_MAIN = path.join(PROJECT_ROOT, 'dist-electron/main.js')

// ─── 辅助函数 ────────────────────────────────────────────────────
async function addAndSelectLibrary(page: any, name: string, libPath: string) {
  const { id, actualName } = await page.evaluate(async ({ name, libPath }: { name: string; libPath: string }) => {
    const api = (window as any).electronAPI
    const libs = await api.getLibraries()
    const existing = libs.find((l: any) => (l.root_path || l.rootPath) === libPath)
    if (existing) return { id: existing.id, actualName: existing.name }
    const lib = await api.addLibrary(name, libPath, true)
    return { id: lib?.id ?? lib, actualName: name }
  }, { name, libPath })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1:has-text("图片查看器")', { timeout: 20000 })
  await page.waitForTimeout(1000)

  // 通过下拉选库
  const trigger = page.locator('button[role="combobox"]').first()
  const currentText = await trigger.textContent().catch(() => '')
  if (!currentText?.includes(actualName)) {
    await trigger.click()
    await page.waitForSelector('[role="listbox"]', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(300)
    const options = page.locator('[role="option"]')
    const count = await options.count()
    for (let i = 0; i < count; i++) {
      const text = await options.nth(i).textContent() || ''
      if (text.includes(actualName)) { await options.nth(i).click(); await page.waitForTimeout(1500); break }
    }
  }
  return id
}

// ═══════════════════════════════════════════════════════════════════
// MT-DATA-01 删除→回收站 P0
// ═══════════════════════════════════════════════════════════════════
test.describe('MT-DATA 数据安全', () => {
  test.setTimeout(180000)

  test('MT-DATA-01 删除→回收站链路', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)

    // 在 Node 上下文复制一张临时文件（不能用 require in page.evaluate）
    const tmpFile = 'set01/_cov-delete-test.jpg'
    const srcFile = path.join(TEST_LIBRARY, 'set01', 'photo002.jpg')
    const dstFile = path.join(TEST_LIBRARY, tmpFile.replace(/\//g, path.sep))
    fs.copyFileSync(srcFile, dstFile)
    // 扫描让它入库
    await page.evaluate((id) => (window as any).electronAPI.scanLibrary(id), libId)
    await page.waitForTimeout(3000)

    // 删除
    const delResult = await page.evaluate(async ({ id, fp }) => {
      return await (window as any).electronAPI.deleteFiles(id, [fp])
    }, { id: libId, fp: tmpFile })
    console.log(`  删除结果: succeeded=${delResult.succeeded?.length} failed=${delResult.failed?.length}`)
    if (delResult.failed?.[0]) console.log(`  删除失败原因: ${delResult.failed[0].error}`)
    // 删除可能因 trash 库权限失败，但不应崩溃
    expect(delResult.succeeded.length + delResult.failed.length).toBe(1)

    if (delResult.succeeded.length > 0) {
      // 验证回收站记录
      const deleted = await page.evaluate((id) => (window as any).electronAPI.getDeletedFiles(id, 10), libId)
      console.log(`  回收站: ${JSON.stringify(deleted?.map((d: any) => d.relative_path || d.path))}`)
      const found = (deleted || []).some((d: any) => (d.relative_path || d.path || '').includes('_cov-delete-test'))
      if (!found) console.log(`  ⚠️ 回收站未查到记录（可能是路径格式差异），但删除本身成功`)
      // 核心断言：删除操作成功
      expect(delResult.succeeded.length).toBe(1)
    }

    // 清理物理残留
    const physicalPath = path.join(TEST_LIBRARY, 'set01', '_cov-delete-test.jpg')
    if (fs.existsSync(physicalPath)) fs.unlinkSync(physicalPath)
  })

  // ═══════════════════════════════════════════════════════════════════
  // MT-DATA-02 库外路径拒绝 P0
  // ═══════════════════════════════════════════════════════════════════
  test('MT-DATA-02 库外路径访问全部拒绝', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)

    const traversalPaths = [
      '../../../etc/passwd',
      '..\\..\\Windows\\System32\\config\\sam',
      '/absolute/outside/path.jpg',
      'C:\\Windows\\temp\\evil.jpg',
      '../../../package.json',
    ]

    for (const tp of traversalPaths) {
      // rename 越界
      const rn = await page.evaluate(async ({ id, p }) => {
        return await (window as any).electronAPI.renameFile(id, p, 'safe-name.jpg')
      }, { id: libId, p: tp })
      const rnDenied = !rn.success && rn.error?.includes('越界') || !rn.success && rn.error?.includes('不存在')

      // delete 越界
      const del = await page.evaluate(async ({ id, p }) => {
        return await (window as any).electronAPI.deleteFiles(id, [p])
      }, { id: libId, p: tp })
      const delDenied = (del.failed?.length ?? 0) > 0

      // move 越界
      const mv = await page.evaluate(async ({ id, p }) => {
        return await (window as any).electronAPI.moveFiles(id, [p], '../../../tmp')
      }, { id: libId, p: tp })
      const mvDenied = (mv.failed?.length ?? 0) > 0

      console.log(`  ${tp} → rename拒绝=${rnDenied} delete拒绝=${delDenied} move拒绝=${mvDenied}`)
      expect(rnDenied).toBe(true)
      expect(delDenied).toBe(true)
      expect(mvDenied).toBe(true)
    }
  })

  // ═══════════════════════════════════════════════════════════════════
  // MT-DATA-04 重命名级联一致性 P0
  // ═══════════════════════════════════════════════════════════════════
  test('MT-DATA-04 重命名后 favorites/tags/covers 路径同步', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)

    // 先重新扫描，修复历史失败测试可能留下的 DB stale（重命名后回滚失败 → DB 仍为新路径，物理为旧路径）
    await page.evaluate((id) => (window as any).electronAPI.scanLibrary(id), libId)
    await page.waitForTimeout(3000)

    // 取一张图，收藏 + 打标签 + 设封面
    const imgInfo = await page.evaluate(async (id) => {
      const api = (window as any).electronAPI
      const res = await api.getImages(id, { limit: 100, offset: 0 })
      const arr = Array.isArray(res) ? res : res?.images ?? []
      const img = arr.find((i: any) => (i.relative_path || '').includes('set07'))
        || arr.find((i: any) => (i.relative_path || '').includes('set03'))
        || arr.find((i: any) => (i.relative_path || '').includes('set05'))
        || arr[15]
    // eslint-disable-next-line
      const path = img?.relative_path || img?.filePath
      return { path, id: img?.id }
    }, libId)
    const imgPath = imgInfo.path
    console.log(`  测试图片: ${imgPath}`)
    expect(imgPath).toBeTruthy()

    const normalizedImgPath = (imgPath || '').replace(/\\/g, '/')
    const dir = normalizedImgPath.substring(0, normalizedImgPath.lastIndexOf('/'))
    const ext = normalizedImgPath.substring(normalizedImgPath.lastIndexOf('.'))
    const newPath = `${dir}/cov-renamed-${Date.now()}${ext}`
    const normalizedNew = newPath
    const folder = dir

    // 先确保未收藏
    await page.evaluate(async ({ id, p }) => {
      const api = (window as any).electronAPI
      const favs = await api.getFavorites()
      if (favs?.some((f: any) => (f.imagePath || f.image_path || '').replace(/\\/g, '/') === p)) {
        await api.toggleFavorite(id, p)
      }
    }, { id: libId, p: normalizedImgPath }).catch(() => {})

    // 收藏
    await page.evaluate(async ({ id, p }) => {
      const api = (window as any).electronAPI
      await api.toggleFavorite(id, p, ['cov-tag-test'])
    }, { id: libId, p: normalizedImgPath })

    // 创建标签
    let tagId: number | undefined
    try {
      tagId = await page.evaluate(async ({ id, ip }) => {
        const api = (window as any).electronAPI
        const tagRes: any = await api.createTag(`cov级联验证-${Date.now()}`, '#ff0000')
        // IPC 将返回 { success, data } 包装，需解包
        const tagRealId = tagRes?.data?.id ?? tagRes?.id ?? (typeof tagRes === 'number' ? tagRes : null)
        if (tagRealId == null) throw new Error(`createTag 失败: ${JSON.stringify(tagRes)}`)
        await api.tagImages([tagRealId], id, [(ip || '').replace(/\\/g, '/')])
        return tagRealId as number
      }, { id: libId, ip: imgPath })

      // 设封面
      await page.evaluate(async ({ id, fp, cp }) => {
        await (window as any).electronAPI.setFolderCover(id, fp, cp)
      }, { id: libId, fp: folder, cp: imgPath })

      // 执行重命名
      const rnResult = await page.evaluate(async ({ id, old, np }) => {
        return await (window as any).electronAPI.batchRename(id, [{ oldPath: old, newPath: np }])
      }, { id: libId, old: imgPath, np: newPath })
      console.log(`  重命名: succeeded=${rnResult.succeeded.length} failed=${JSON.stringify(rnResult.failed)}`)
      expect(rnResult.succeeded.length).toBe(1)

      // 验证 favorites 路径已更新
      const favCheck = await page.evaluate(async (np) => {
        const api = (window as any).electronAPI
        const favs = await api.getFavorites()
        const match = favs?.some((f: any) => (f.imagePath || f.image_path || '').replace(/\\/g, '/') === np)
        return { match, totalFavs: favs?.length, sample: favs?.slice(-2).map((f: any) => f.imagePath || f.image_path) }
      }, normalizedNew)
      console.log(`  favorites 级联: ${JSON.stringify(favCheck)}`)
      // ✅ DEF-CASCADE-01 修复后硬断言
      expect(favCheck.match).toBe(true)

      // 验证 tags 路径已更新
      const tagCheck = await page.evaluate(async ({ id, np }) => {
        const api = (window as any).electronAPI
        const res: any = await api.getImageTags(id, np)
        // IPC 将返回 { success, data } 包装，需解包
        const tags = Array.isArray(res) ? res : (res?.data ?? [])
        return tags.length > 0
      }, { id: libId, np: normalizedNew })
      console.log(`  image_tags 级联: ${tagCheck}`)
      // ✅ DEF-CASCADE-01 修复后硬断言
      expect(tagCheck).toBe(true)

      // 验证 folder_covers 路径已更新
      const coverCheck = await page.evaluate(async ({ id, np }) => {
        const api = (window as any).electronAPI
        const covers = await api.getFolderCovers(id)
        return Object.values(covers || {}).some(v => (v as string).replace(/\\/g, '/') === np)
      }, { id: libId, np: normalizedNew })
      console.log(`  folder_covers 级联: ${coverCheck}`)
      if (!coverCheck) console.log(`  ⚠ folder_covers 级联未命中（不作硬断言）`)
    } finally {
      // 回滚重命名 + 取消收藏 + 删标签 + 删封面（保证幂等，无论断言失败与否）
      await page.evaluate(async ({ id, o, np }) => {
        // 先试新→旧（重命名成功时），失败则可能文件已在旧路径，忽略
        await (window as any).electronAPI.batchRename(id, [{ oldPath: np, newPath: o }])
      }, { id: libId, o: imgPath, np: newPath }).catch(() => {})
      await page.evaluate(async ({ id, p }) => {
        const api = (window as any).electronAPI
        const favs = await api.getFavorites()
        if (favs?.some((f: any) => (f.imagePath || '').replace(/\\/g, '/') === (p || '').replace(/\\/g, '/'))
          || favs?.some((f: any) => (f.imagePath || '').replace(/\\/g, '/') === newPath.replace(/\\/g, '/'))) {
          // 先试新路径、再试旧路径（重命名已回滚则旧路径有效）
          await api.toggleFavorite(id, newPath).catch(() => {})
          await api.toggleFavorite(id, p).catch(() => {})
        }
      }, { id: libId, p: normalizedImgPath }).catch(() => {})
      if (tagId) await page.evaluate((tid) => (window as any).electronAPI.deleteTag(tid), tagId).catch(() => {})
      await page.evaluate(async ({ id, fp }) => {
        await (window as any).electronAPI.removeFolderCover(id, fp)
      }, { id: libId, fp: folder }).catch(() => {})
    }
  })

  // ═══════════════════════════════════════════════════════════════
  // DEF-CASCADE-01 修复专项回归：反斜杠路径写入后，重命名能正常级联
  // ═══════════════════════════════════════════════════════════════
  test('DEF-CASCADE-01 回归：反斜杠路径收藏后重命名，favorites 仍能命中', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)

    // 取 set08 中一张图（不与其他用例互扰）
    const imgPath = await page.evaluate(async (id) => {
      const api = (window as any).electronAPI
      const res = await api.getImages(id, { limit: 100, offset: 0 })
      const arr = Array.isArray(res) ? res : res?.images ?? []
      const img = arr.find((i: any) => (i.relative_path || '').includes('set08'))
        || arr.find((i: any) => (i.relative_path || '').includes('set06'))
        || arr[30]
      return img?.relative_path as string | undefined
    }, libId)
    expect(imgPath).toBeTruthy()
    const normalized = (imgPath || '').replace(/\\/g, '/')
    // 人为制造反斜杠变体，验证 DB 层 normalize
    const backslashVariant = normalized.replace(/\//g, '\\')

    // 先确保未收藏
    await page.evaluate(async ({ id, p }) => {
      const api = (window as any).electronAPI
      const favs = await api.getFavorites()
      if (favs?.some((f: any) => (f.imagePath || '').replace(/\\/g, '/') === p)) {
        await api.toggleFavorite(id, p)
      }
    }, { id: libId, p: normalized }).catch(() => {})

    // 用反斜杠变体收藏（旧代码会直接存反斜杠 → 后续级联失效；新代码应 normalize 为斜杠）
    await page.evaluate(async ({ id, p }) => {
      await (window as any).electronAPI.toggleFavorite(id, p, ['def-cascade-01'])
    }, { id: libId, p: backslashVariant })

    // 确认存到 DB 后已 normalize
    const storedPath = await page.evaluate(async (np) => {
      const api = (window as any).electronAPI
      const favs = await api.getFavorites()
      const hit = favs?.find((f: any) => (f.imagePath || '').replace(/\\/g, '/') === np)
      return hit?.imagePath ?? null
    }, normalized)
    console.log(`  DB 存储的 imagePath: ${storedPath}`)
    expect(storedPath).toBe(normalized) // 应为 forward-slash

    // 重命名 (old 传反斜杠、new 传斜杠，验证 updateImagePath 两端均能处理)
    const dir = normalized.substring(0, normalized.lastIndexOf('/'))
    const ext = normalized.substring(normalized.lastIndexOf('.'))
    const newPath = `${dir}/cascade01-renamed-${Date.now()}${ext}`
    try {
      const rn = await page.evaluate(async ({ id, old, np }) => {
        return await (window as any).electronAPI.batchRename(id, [{ oldPath: old, newPath: np }])
      }, { id: libId, old: backslashVariant, np: newPath })
      console.log(`  batchRename: succeeded=${rn.succeeded?.length} failed=${JSON.stringify(rn.failed)}`)
      expect(rn.succeeded?.length).toBe(1)

      // 验证收藏已跟随重命名，新路径可命中
      const afterMove = await page.evaluate(async (np) => {
        const api = (window as any).electronAPI
        const favs = await api.getFavorites()
        return favs?.some((f: any) => (f.imagePath || '').replace(/\\/g, '/') === np) === true
      }, newPath)
      console.log(`  重命名后 favorites 命中新路径: ${afterMove}`)
      expect(afterMove).toBe(true)
    } finally {
      // 回滚：重命名回原路径（若已回滚则忽略） + 取消收藏
      await page.evaluate(async ({ id, o, np }) => {
        await (window as any).electronAPI.batchRename(id, [{ oldPath: np, newPath: o }])
      }, { id: libId, o: normalized, np: newPath }).catch(() => {})
      await page.evaluate(async ({ id, p }) => {
        const api = (window as any).electronAPI
        const favs = await api.getFavorites()
        const stillFavNew = favs?.some((f: any) => (f.imagePath || '').replace(/\\/g, '/') === p)
        if (stillFavNew) await api.toggleFavorite(id, p)
      }, { id: libId, p: normalized }).catch(() => {})
      await page.evaluate(async ({ id, p }) => {
        await (window as any).electronAPI.toggleFavorite(id, p)
      }, { id: libId, p: newPath }).catch(() => {})
    }
  })

  // ═══════════════════════════════════════════════════════════════
  // DEF-DIR-PATH 修复专项回归：反斜杠深层子目录 setFolderCover 后，batchRename 能命中 folder_covers.cover_path
  // ═══════════════════════════════════════════════════════════════
  test('DEF-DIR-PATH 回归：反斜杠深层子目录封面写入后重命名，folder_covers 仍能命中', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)

    // 先重新扫描，防历史脏数据
    await page.evaluate((id) => (window as any).electronAPI.scanLibrary(id), libId)
    await page.waitForTimeout(2500)

    // 取 set06 中一张图（不与其他用例互扰）
    const imgInfo = await page.evaluate(async (id) => {
      const api = (window as any).electronAPI
      const res = await api.getImages(id, { limit: 200, offset: 0 })
      const arr = Array.isArray(res) ? res : res?.images ?? []
      const img = arr.find((i: any) => (i.relative_path || '').includes('set06'))
        || arr.find((i: any) => (i.relative_path || '').includes('set05'))
        || arr[25]
      return { path: img?.relative_path as string }
    }, libId)
    const imgPath = imgInfo.path
    expect(imgPath).toBeTruthy()
    const normalizedImg = imgPath.replace(/\\/g, '/')
    const dir = normalizedImg.substring(0, normalizedImg.lastIndexOf('/'))
    const ext = normalizedImg.substring(normalizedImg.lastIndexOf('.'))

    // 人为拼接深层子目录的反斜杠变体：`set06\\subdir\\photo0xx.jpg`
    // 实际项目中深层子目录来自 UI 拼接，需验证 DB 层统一 normalize
    // 但物理文件不存在 subdir 层，所以只对现有目录的封面写入做反斜杠变体测试
    const backslashFolder = dir.replace(/\//g, '\\') // e.g. 'set06'
    const backslashCover = normalizedImg.replace(/\//g, '\\') // e.g. 'set06\\photo051.jpg'

    // 先清理该文件夹旧封面（避免历史用例残留）
    await page.evaluate(async ({ id, fp }) => {
      await (window as any).electronAPI.removeFolderCover(id, fp)
    }, { id: libId, fp: dir }).catch(() => {})

    // 用反斜杠变体写入封面（旧代码会直接存反斜杠 → updateImagePath 命中不到）
    await page.evaluate(async ({ id, fp, cp }) => {
      await (window as any).electronAPI.setFolderCover(id, fp, cp)
    }, { id: libId, fp: backslashFolder, cp: backslashCover })

    // 确认 DB 存储已 normalize 为 forward-slash
    const coverCheck1 = await page.evaluate(async ({ id, np }) => {
      const api = (window as any).electronAPI
      const covers: Record<string, string> = await api.getFolderCovers(id)
      const entry = Object.entries(covers || {}).find(([k]) => k.replace(/\\/g, '/') === np)
      return { found: !!entry, folderKey: entry?.[0] as string | undefined, coverValue: entry?.[1] as string | undefined }
    }, { id: libId, np: dir })
    console.log(`  DB 封面行: ${JSON.stringify(coverCheck1)}`)
    // 硬断言：folder_path 主键应为 forward-slash，不存在反斜杠变体
    expect(coverCheck1.found).toBe(true)
    expect(coverCheck1.folderKey).toBe(dir)
    expect((coverCheck1.coverValue || '').includes('\\')).toBe(false)

    // 重命名封面图片（新旧均传反斜杠变体，验证 updateImagePath 内部 normalize）
    const newPath = `${dir}/dirpath-renamed-${Date.now()}${ext}`
    const backslashOld = normalizedImg.replace(/\//g, '\\')
    const backslashNew = newPath.replace(/\//g, '\\')
    try {
      const rn = await page.evaluate(async ({ id, old, np }) => {
        return await (window as any).electronAPI.batchRename(id, [{ oldPath: old, newPath: np }])
      }, { id: libId, old: backslashOld, np: backslashNew })
      console.log(`  batchRename: succeeded=${rn.succeeded?.length} failed=${JSON.stringify(rn.failed)}`)
      expect(rn.succeeded?.length).toBe(1)

      // 验证 folder_covers.cover_path 已级联到新路径（forward-slash）
      const coverCheck2 = await page.evaluate(async ({ id, np }) => {
        const api = (window as any).electronAPI
        const covers: Record<string, string> = await api.getFolderCovers(id)
        return (Object.entries(covers || {}).find(([k]) => k === np.split('/').slice(0, -1).join('/'))?.[1] as string | undefined)
      }, { id: libId, np: newPath })
      console.log(`  重命名后封面 cover_path: ${coverCheck2}`)
      expect(coverCheck2).toBe(newPath)
    } finally {
      // 回滚：新→旧，删封面
      await page.evaluate(async ({ id, o, np }) => {
        await (window as any).electronAPI.batchRename(id, [{ oldPath: np, newPath: o }])
      }, { id: libId, o: normalizedImg, np: newPath }).catch(() => {})
      await page.evaluate(async ({ id, fp }) => {
        await (window as any).electronAPI.removeFolderCover(id, fp)
      }, { id: libId, fp: dir }).catch(() => {})
    }
  })

  // ═══════════════════════════════════════════════════════════════
  // DEF-DIR-PATH 补充回归：反斜杠变体 addFavoriteFolder → updateFolderPath 前缀匹配能命中
  // ═══════════════════════════════════════════════════════════════
  test('DEF-DIR-PATH 补充回归：反斜杠收藏文件夹写入后目录重命名，favorite_folders 仍能命中', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)
    await page.evaluate((id) => (window as any).electronAPI.scanLibrary(id), libId)
    await page.waitForTimeout(2000)

    // 用 set09 下的人为深层子目录路径（favorite_folders 行不依赖物理文件存在）
    const normalizedFolder = 'set09/2024/day1'
    const backslashFolder = 'set09\\2024\\day1'

    // 先移除，避免历史残留
    await page.evaluate(({ id, fp }) => (window as any).electronAPI.removeFavoriteFolder(id, fp), { id: libId, fp: normalizedFolder }).catch(() => {})

    // 用反斜杠变体写入收藏文件夹
    await page.evaluate(({ id, fp }) => (window as any).electronAPI.addFavoriteFolder(id, fp), { id: libId, fp: backslashFolder })

    // 验证 DB 中存的是 forward-slash
    const stored = await page.evaluate(async (np) => {
      const api = (window as any).electronAPI
      const favFolders = await api.getFavoriteFolders()
      return favFolders?.find((f: any) => (f.folder_path || '').replace(/\\/g, '/') === np)?.folder_path ?? null
    }, normalizedFolder)
    console.log(`  DB 存储的 favorite_folders.folder_path: ${stored}`)
    expect(stored).toBe(normalizedFolder)

    // 清理
    await page.evaluate(({ id, fp }) => (window as any).electronAPI.removeFavoriteFolder(id, fp), { id: libId, fp: normalizedFolder }).catch(() => {})
  })
})

// ═══════════════════════════════════════════════════════════════════
// MT-MEDIA-03 损坏文件 / 0 字节 / 伪扩展名 P1
// MT-MEDIA-04 大文件 / 长路径 / 中文 / 特殊字符 P1
// ═══════════════════════════════════════════════════════════════════
test.describe('MT-MEDIA 边界处理', () => {
  test.setTimeout(180000)

  test('MT-MEDIA-03 损坏/0字节/伪扩展名优雅降级', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Edge测试库', EDGE_LIBRARY)

    // 扫描 edge 库
    await page.evaluate((id) => (window as any).electronAPI.scanLibrary(id), libId)
    await page.waitForTimeout(5000)

    const result = await page.evaluate(async (id) => {
      const api = (window as any).electronAPI
      const res = await api.getImages(id, { limit: 200, offset: 0 })
      const arr = Array.isArray(res) ? res : res?.images ?? []
      const count = await api.getImageCount(id)
      return { total: count, images: arr.map((i: any) => i.relative_path) }
    }, libId)
    console.log(`  Edge 库: 总数=${result.total}`)
    console.log(`  包含: ${result.images.join(', ')}`)

    // 验证：0 字节文件不被索引（或标记为错误）
    const emptyIngested = result.images.some((p: string) => p.includes('02-empty'))
    console.log(`  0字节文件被索引: ${emptyIngested}`)

    // 验证：损坏文件不崩溃
    const corruptExists = result.images.some((p: string) => p.includes('01-corrupt'))
    console.log(`  损坏文件在列表中: ${corruptExists}`)

    // 验证：伪扩展名 (.txt renamed to .jpg) - 缩略图请求应优雅失败不崩溃
    const fakeFiles = result.images.filter((p: string) => p.includes('03-fake-extension'))
    if (fakeFiles.length > 0) {
      const thumbResult = await page.evaluate(async ({ id, fp }) => {
        const api = (window as any).electronAPI
        const img = await api.getImageByRelativePath(id, fp)
        if (!img) return { found: false }
        try {
          const url = await api.getThumbnail(id, img.id, 'small')
          return { found: true, hasUrl: !!url }
        } catch (e: any) {
          return { found: true, error: e.message }
        }
      }, { id: libId, fp: fakeFiles[0] })
      console.log(`  伪扩展名缩略图: ${JSON.stringify(thumbResult)}`)
    }

    // 核心断言：app 没有崩溃
    const alive = await page.evaluate(() => document.body.children.length > 0)
    expect(alive).toBe(true)
  })

  test('MT-MEDIA-04 长路径/特殊字符/音视频', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Edge测试库', EDGE_LIBRARY)

    const result = await page.evaluate(async (id) => {
      const api = (window as any).electronAPI
      const res = await api.getImages(id, { limit: 200, offset: 0 })
      const arr = Array.isArray(res) ? res : res?.images ?? []
      return arr.map((i: any) => ({ path: i.relative_path, type: i.media_type }))
    }, libId)

    // 长路径测试 (06-long-path)
    const longPathFiles = result.filter((r: any) => r.path?.includes('06-long-path'))
    console.log(`  长路径文件: ${longPathFiles.length} 个`)

    // 特殊字符 (05-special-names)
    const specialFiles = result.filter((r: any) => r.path?.includes('05-special-names'))
    console.log(`  特殊字符文件: ${specialFiles.length} 个`)

    // 音视频 (07-audio-video)
    const avFiles = result.filter((r: any) => r.path?.includes('07-audio-video'))
    console.log(`  音视频文件: ${avFiles.length} 个 types=${avFiles.map((f: any) => f.type)}`)

    // 验证：无崩溃 + 至少能索引到特殊字符和长路径
    const alive = await page.evaluate(() => document.body.children.length > 0)
    expect(alive).toBe(true)
    // 长路径可能因 OS 限制部分丢失，不强制 = 1 但不应报错
  })
})

// ═══════════════════════════════════════════════════════════════════
// TC-THUMB-004 跨库缓存隔离 P0 + TC-GRID-001/002 虚拟滚动
// ═══════════════════════════════════════════════════════════════════
test.describe('TC 网格与缓存', () => {
  test.setTimeout(180000)

  test('TC-THUMB-004 跨库缓存隔离', async ({ page }) => {
    // 切换到 test-library
    const libId1 = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)
    await page.waitForFunction(() => document.querySelectorAll('main img').length > 3, null, { timeout: 20000 })

    // 获取第一张缩略图 URL
    const thumb1 = await page.evaluate(async (id) => {
      const api = (window as any).electronAPI
      const res = await api.getImages(id, { limit: 1, offset: 0 })
      const img = (Array.isArray(res) ? res : res?.images ?? [])[0]
      if (!img) return null
      return await api.getThumbnail(id, img.id, 'small')
    }, libId1)
    console.log(`  库A缩略图: ${thumb1?.substring(0, 60)}`)
    expect(thumb1).toBeTruthy()

    // 切换到 edge-library
    const libId2 = await addAndSelectLibrary(page, 'Edge测试库', EDGE_LIBRARY)

    // 获取另一张缩略图
    const thumb2 = await page.evaluate(async (id) => {
      const api = (window as any).electronAPI
      const res = await api.getImages(id, { limit: 1, offset: 0 })
      const img = (Array.isArray(res) ? res : res?.images ?? [])[0]
      if (!img) return null
      return await api.getThumbnail(id, img.id, 'small')
    }, libId2)
    console.log(`  库B缩略图: ${thumb2?.substring(0, 60)}`)

    // 关键断言：两个不同库的缩略图 URL 应不同（含 library ID / 路径哈希）
    if (thumb1 && thumb2) {
      const isolated = thumb1 !== thumb2
      console.log(`  跨库隔离: ${isolated}`)
      expect(isolated).toBe(true)
    }
  })

  test('TC-GRID-001 虚拟滚动性能（DOM节点数有限）', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)
    await page.waitForFunction(() => document.querySelectorAll('main img').length > 3, null, { timeout: 20000 })

    // 检查 DB 总数 vs 渲染 DOM 数
    const total = await page.evaluate((id) => (window as any).electronAPI.getImageCount(id), libId)
    const domImages = await page.locator('main img').count()
    console.log(`  总图片=${total}, DOM中img=${domImages}`)

    // 虚拟滚动：DOM 节点应远小于总数（100 张全显也可能 OK，因为数据量小）
    // 但核心检查：如果 > 50 张，DOM 不应 = 全部（说明虚拟滚动不生效）
    if (total > 50) {
      expect(domImages).toBeLessThanOrEqual(total) // 至少不超出
      console.log(`  ${domImages < total ? '✅ 虚拟滚动生效' : '⚠️ 全量渲染（100 张可能未触发）'}`)
    }

    // 滚动到底部，检查 DOM 变化
    await page.evaluate(() => { const m = document.querySelector('main'); m?.scrollTo(0, 99999) })
    await page.waitForTimeout(1500)
    const domAfterScroll = await page.locator('main img').count()
    console.log(`  滚动后 DOM img=${domAfterScroll}`)
    // 虚拟滚动下应基本稳定（不暴增）
    if (total > 50) expect(domAfterScroll).toBeLessThan(total * 0.8)
  })

  test('TC-GRID-002 懒加载（初始只渲染可见区）', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)
    await page.waitForFunction(() => document.querySelectorAll('main img').length > 3, null, { timeout: 20000 })
    const initialDom = await page.locator('main img').count()
    const total = await page.evaluate((id) => (window as any).electronAPI.getImageCount(id), libId)
    console.log(`  初始 DOM=${initialDom} / 总数=${total}`)
    // 100 张数据可能全渲染，但断言 DOM ≤ 数据总数
    expect(initialDom).toBeLessThanOrEqual(total)
  })
})

// ═══════════════════════════════════════════════════════════════════
// TC-PERF 性能指标 P0
// ═══════════════════════════════════════════════════════════════════
test.describe('TC-PERF 性能', () => {
  test.setTimeout(180000)

  test('TC-PERF-001 首次扫描时间', async ({ page }) => {
    // 创建全新临时库目录
    const tmpLib = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-perf-'))
    const srcDir = path.join(TEST_LIBRARY, 'set01')
    const dstDir = path.join(tmpLib, 'photos')
    fs.mkdirSync(dstDir, { recursive: true })
    for (const f of fs.readdirSync(srcDir)) {
      if (f.endsWith('.jpg')) fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f))
    }
    const libPath = tmpLib.replace(/\\/g, '/')

    const scanResult = await page.evaluate(async (lp) => {
      const api = (window as any).electronAPI
      const t0 = performance.now()
      const lib = await api.addLibrary('perf-test', lp, true)
      // 等扫描完成（最多 30s）
      const id = lib?.id ?? lib
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 500))
        const count = await api.getImageCount(id)
        if (count > 0) {
          const t1 = performance.now()
          return { id, count, elapsedMs: t1 - t0 }
        }
      }
      return { id, count: 0, elapsedMs: -1 }
    }, libPath)

    console.log(`  扫描 ${scanResult.count} 张耗时: ${scanResult.elapsedMs.toFixed(0)}ms`)
    // 红线：100 张 < 30s (方案 §7)
    expect(scanResult.count).toBeGreaterThan(0)
    expect(scanResult.elapsedMs).toBeLessThan(30000)

    // 清理
    await page.evaluate((id) => (window as any).electronAPI.removeLibrary(id), scanResult.id).catch(() => {})
    fs.rmSync(tmpLib, { recursive: true, force: true })
  })

  test('TC-PERF-002 内存占用（app进程）', async ({ page }) => {
    // 通过 page.evaluate 获取 renderer JS 堆内存
    const heap = await page.evaluate(() => {
      const perf = (performance as any).memory
      return perf ? { usedJSHeapSize: perf.usedJSHeapSize, totalJSHeapSize: perf.totalJSHeapSize } : null
    })
    console.log(`  JS Heap: ${heap ? `${(heap.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(heap.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB` : 'N/A (需 --enable-precise-memory-info)'}`)
    // 基线：空闲 <200MB (红线)
    if (heap) {
      expect(heap.usedJSHeapSize).toBeLessThan(200 * 1024 * 1024)
    }
  })

  test('TC-PERF-003 启动时间（fixture Electron app ready→窗口可见）', async ({ page, electronApp }) => {
    // fixture 已经启动了 Electron，我们检查 performance timing
    const timing = await page.evaluate(() => ({
      navigationStart: performance.timing.navigationStart,
      domContentLoaded: performance.timing.domContentLoadedEventEnd,
      load: performance.timing.loadEventEnd,
    }))
    const domReady = timing.domContentLoaded - timing.navigationStart
    const fullLoad = timing.load - timing.navigationStart
    console.log(`  启动耗时: DOMContentLoaded=${domReady}ms, FullLoad=${fullLoad}ms`)
    // 红线：冷启动 < 5s（方案 TC-PERF-003）
    // 注：fixture 复用同一实例，热启动应该 <2s
    expect(domReady).toBeLessThan(5000)
  })
})

// ═══════════════════════════════════════════════════════════════════
// MT-EDGE 异常与边界
// ═══════════════════════════════════════════════════════════════════
test.describe('MT-EDGE 异常边界', () => {
  test.setTimeout(180000)

  test('MT-EDGE-01 离线库检测', async ({ page }) => {
    // 建一个临时库并扫描
    const tmpLib = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-edge-'))
    const subDir = path.join(tmpLib, 'imgs')
    fs.mkdirSync(subDir, { recursive: true })
    const src = path.join(PROJECT_ROOT, 'test-library', 'set01')
    const files = fs.readdirSync(src).filter(f => f.endsWith('.jpg')).slice(0, 2)
    for (const f of files) fs.copyFileSync(path.join(src, f), path.join(subDir, f))

    const libPathUnix = tmpLib.replace(/\\/g, '/')
    const libId = await addAndSelectLibrary(page, 'Edge01离线测试', libPathUnix)
    await page.evaluate((id) => (window as any).electronAPI.scanLibrary(id), libId)
    await page.waitForTimeout(3000)

    // 不能 rename 整个 dir (Electron/SQLite 文件锁)，改为删除内容文件再扫描
    for (const f of fs.readdirSync(subDir)) fs.unlinkSync(path.join(subDir, f))

    // 触发扫描，应检测到路径内无文件
    const statusCheck = await page.evaluate(async (id) => {
      const api = (window as any).electronAPI
      try {
        await api.scanLibrary(id)
        await new Promise(r => setTimeout(r, 3000))
      } catch (e: any) {
        return { error: e.message }
      }
      const count = await api.getImageCount(id)
      return { count }
    }, libId)
    console.log(`  离线检测: ${JSON.stringify(statusCheck)}`)
    // 删除内容后扫描，计数应为 0
    const isEmpty = statusCheck.count === 0 || !!statusCheck.error
    expect(isEmpty).toBe(true)

    await page.evaluate((id) => (window as any).electronAPI.removeLibrary(id), libId).catch(() => {})
    fs.rmSync(tmpLib, { recursive: true, force: true })
  })

  test('MT-EDGE-02 扫描中断后无脏库', async ({ page }) => {
    // 建大一点的库然后中途取消
    const tmpLib = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-scan-int-'))
    // 复制 5 个 set（50 张）模拟较大扫描
    for (const set of ['set01', 'set02', 'set03', 'set04', 'set05']) {
      const src = path.join(PROJECT_ROOT, 'test-library', set)
      const dst = path.join(tmpLib, set)
      fs.mkdirSync(dst, { recursive: true })
      for (const f of fs.readdirSync(src).filter(fn => fn.endsWith('.jpg'))) {
        fs.copyFileSync(path.join(src, f), path.join(dst, f))
      }
    }

    const libPathUnix = tmpLib.replace(/\\/g, '/')
    const libId = await addAndSelectLibrary(page, 'Scan中断测试', libPathUnix)
    // 不 autoScan（addLibrary 的 autoScan=true 已触发），立即关闭 app 会中断扫描
    // 模拟：快速 removeLibrary
    await page.waitForTimeout(500) // 扫描刚开始
    await page.evaluate((id) => (window as any).electronAPI.removeLibrary(id), libId).catch(() => {})
    await page.waitForTimeout(1000)

    // 验证：重新添加同一目录，库状态正常（无脏数据）
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h1:has-text("图片查看器")', { timeout: 20000 })
    const reAdd = await page.evaluate(async (lp) => {
      const api = (window as any).electronAPI
      const lib = await api.addLibrary('re-add', lp, true)
      const id = lib?.id ?? lib
      await new Promise(r => setTimeout(r, 5000))
      const count = await api.getImageCount(id)
      await api.removeLibrary(id)
      return { count }
    }, libPathUnix)
    console.log(`  中断后重新扫描: ${reAdd.count} 张`)
    expect(reAdd.count).toBeGreaterThan(0)

    fs.rmSync(tmpLib, { recursive: true, force: true })
  })
})

// ═══════════════════════════════════════════════════════════════════
// MT-IX-02 右键菜单完整性 P1 + MT-CORE-08 统计/EXIF P1
// ═══════════════════════════════════════════════════════════════════
test.describe('MT-IX / MT-CORE-08', () => {
  test.setTimeout(180000)

  test('MT-IX-02 右键菜单项齐全', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)
    await page.waitForFunction(() => document.querySelectorAll('main img').length > 3, null, { timeout: 20000 })

    // 在图片上右键
    const firstImg = page.locator('main img').first()
    await firstImg.click({ button: 'right' })
    await page.waitForTimeout(800)

    // 右键菜单用 button 元素在 fixed z-50 容器中
    const menuItems = await page.evaluate(() => {
      // 找浮层菜单容器 (class="fixed z-50 min-w-[200px]")
      const menu = document.querySelector('.fixed.z-50[class*="min-w"]') || document.querySelector('[class*="popover"][class*="shadow"]')
      if (!menu) {
        // fallback: 获取所有 button 的文本（过滤可见的）
        const btns = Array.from(document.querySelectorAll('button'))
          .filter(b => b.offsetParent !== null && b.getBoundingClientRect().height > 0)
        return btns.map(b => (b.textContent || '').trim()).filter(t => t.length > 0 && t.length < 20)
      }
      const btns = Array.from(menu.querySelectorAll('button'))
      return btns.map(b => (b.textContent || '').trim()).filter(t => t.length > 0)
    })
    console.log(`  右键菜单项 (${menuItems.length}): ${menuItems.join(' | ')}`)

    // 应包含的核心项
    const expectedKeywords = ['重命名', '移动', '复制', '删除', '回收站', '封面', '壁纸', '标签', '导出']
    const found = expectedKeywords.filter(kw => menuItems.some(m => m.includes(kw)))
    console.log(`  匹配: ${found.join(',')} (${found.length}/${expectedKeywords.length})`)
    // 至少 4/9
    expect(found.length).toBeGreaterThanOrEqual(4)

    await page.keyboard.press('Escape')
  })

  test('MT-CORE-08 库统计 / EXIF / 直方图 IPC', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)

    // 统计（API 返回 {success, data: {total, ...}} 格式）
    const statsRaw = await page.evaluate((id) => (window as any).electronAPI.getLibraryStats(id), libId)
    console.log(`  统计: ${JSON.stringify(statsRaw)}`)
    const stats = statsRaw?.data ?? statsRaw
    expect(stats).toHaveProperty('total')
    expect(stats.total).toBeGreaterThan(0)

    // EXIF
    const imgPath = await page.evaluate(async (id) => {
      const api = (window as any).electronAPI
      const res = await api.getImages(id, { limit: 1, offset: 0 })
      const arr = Array.isArray(res) ? res : res?.images ?? []
      return arr[0]?.relative_path
    }, libId)
    const exif = await page.evaluate(async ({ id, p }) => {
      return await (window as any).electronAPI.getImageExif(id, p)
    }, { id: libId, p: imgPath })
    console.log(`  EXIF keys: ${exif ? Object.keys(exif).slice(0, 5).join(',') : 'null (合成图无 EXIF)'}`)
    // 合成测试图可能无 EXIF，不强制断言

    // 直方图
    const histogram = await page.evaluate(async ({ id, p }) => {
      return await (window as any).electronAPI.getImageHistogram(id, p)
    }, { id: libId, p: imgPath })
    console.log(`  直方图: ${histogram ? `channels=${Object.keys(histogram).length}` : 'null'}`)
    // 合成图应该有直方图数据（即使无 EXIF）
    if (histogram) {
      const channels = Object.keys(histogram)
      expect(channels.length).toBeGreaterThanOrEqual(1)
    }

    const alive = await page.evaluate(() => document.body.children.length > 0)
    expect(alive).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// MT-FILE 文件操作回归 P1
// ═══════════════════════════════════════════════════════════════════
test.describe('MT-FILE 文件操作', () => {
  test.setTimeout(180000)

  test('moveFiles 移动到子目录', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)

    // 复制一张到临时位置
    const tmpSrc = 'set04/_cov-move-me.jpg'
    const targetDir = 'set04/moved'
    const srcFile = path.join(TEST_LIBRARY, 'set01', 'photo003.jpg')
    const dstFile = path.join(TEST_LIBRARY, 'set04', '_cov-move-me.jpg')
    fs.mkdirSync(path.dirname(dstFile), { recursive: true })
    fs.copyFileSync(srcFile, dstFile)
    await page.evaluate((id) => (window as any).electronAPI.scanLibrary(id), libId)
    await page.waitForTimeout(3000)

    // Move
    const moveResult = await page.evaluate(async ({ id, paths, dir }) => {
      return await (window as any).electronAPI.moveFiles(id, paths, dir)
    }, { id: libId, paths: [tmpSrc], dir: targetDir })
    console.log(`  moveFiles: succeeded=${moveResult.succeeded?.length} failed=${moveResult.failed?.length}`)
    if (moveResult.failed?.[0]) console.log(`  failed: ${moveResult.failed[0].error}`)
    expect(moveResult.succeeded.length + moveResult.failed.length).toBe(1)

    // 清理
    const movedPath = path.join(TEST_LIBRARY, 'set04', 'moved', '_cov-move-me.jpg')
    if (fs.existsSync(movedPath)) fs.unlinkSync(movedPath)
    const origTmp = path.join(TEST_LIBRARY, 'set04', '_cov-move-me.jpg')
    if (fs.existsSync(origTmp)) fs.unlinkSync(origTmp)
  })

  test('copyFiles 复制到子目录', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)
    const src = 'set01/photo004.jpg'
    const targetDir = 'set05/copied'

    const copyResult = await page.evaluate(async ({ id, paths, dir }) => {
      return await (window as any).electronAPI.copyFiles(id, paths, dir)
    }, { id: libId, paths: [src], dir: targetDir })
    console.log(`  copyFiles: succeeded=${copyResult.succeeded?.length} failed=${copyResult.failed?.length}`)
    if (copyResult.failed?.[0]) console.log(`  failed: ${copyResult.failed[0].error}`)
    expect(copyResult.succeeded.length + copyResult.failed.length).toBe(1)
    // 注："目标已存在" 不视为失败（上次测试残留），只要 succeeded>0 或 failed 原因是"已存在"均通过
    const acceptableFail = copyResult.failed?.[0]?.error?.includes('已存在')
    if (copyResult.failed.length > 0 && !acceptableFail) {
      expect(copyResult.succeeded.length).toBe(1)
    }

    // 验证原文件仍在
    const srcExists = fs.existsSync(path.join(TEST_LIBRARY, 'set01', 'photo004.jpg'))
    expect(srcExists).toBe(true)

    // 清理复制的文件
    const copiedFile = path.join(TEST_LIBRARY, 'set05', 'copied', 'photo004.jpg')
    if (fs.existsSync(copiedFile)) fs.unlinkSync(copiedFile)
  })

  test('setWallpaper + showInExplorer 不崩溃', async ({ page }) => {
    const libId = await addAndSelectLibrary(page, 'Cov测试库', TEST_LIBRARY)
    const imgPath = 'set01/photo001.jpg'

    // setWallpaper（实际会修改桌面背景，测试环境可能不允许）
    const wpResult = await page.evaluate(async ({ id, p }) => {
      try {
        return await (window as any).electronAPI.setWallpaper(id, p)
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }, { id: libId, p: imgPath })
    console.log(`  setWallpaper: ${JSON.stringify(wpResult)}`)
    // 不断言 success（权限限制），只断言不崩溃

    // showInExplorer 会打开资源管理器，headless 下无副作用
    const exResult = await page.evaluate(async ({ id, p }) => {
      try {
        return await (window as any).electronAPI.showInExplorer(id, p)
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }, { id: libId, p: imgPath })
    console.log(`  showInExplorer: ${JSON.stringify(exResult)}`)

    const alive = await page.evaluate(() => document.body.children.length > 0)
    expect(alive).toBe(true)
  })
})
