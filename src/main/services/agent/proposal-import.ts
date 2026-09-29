/**
 * T18 — ProposalImportService（accept 下游：把已采留档迁入主库）
 *
 * 时序：M3 发现阶段 intake 已把媒体下载到 `{库根}/_downloads/`（scanner 对下划线目录跳过，§8.3），
 * 仅写 crawl_items 留档，不碰主库 images 表。用户在 DiscoverPanel accept 提案后，本服务把该页面
 * 对应的 `_downloads` 媒体迁入库内可见目录（`Imported/`），再触发增量扫描登记（缩略图/元数据全复用 scanner）。
 *
 * skip/reject 不迁移（留 `_downloads` 由后续清理策略处理，人在回路绝不自动删用户内容）。
 *
 * 可测性：文件迁移与库扫描全部经依赖注入，单测用临时目录 + 假 scan，零 sharp/零真实网络。
 */
import fs from 'fs'
import path from 'path'
import { logger } from '../../../utils/logger'
import { sidecarPath } from '../crawler/intake'
import type { CrawlItemRow } from '../crawler/crawl-item-store'
import type { CandidateItem } from '../../../types/agent'

const LOG_KEY = 'ProposalImport'

/** 迁入主库的落地目录名（不能带下划线前缀，否则又被 scanner 排除） */
export const IMPORT_DIR = 'Imported'

export interface ProposalImportDeps {
  /** 取某来源某页面已采留档媒体行 */
  listMedia(sourceId: number, sourceUrl: string): CrawlItemRow[]
  /** 迁移后回写 crawl_items.image_path（保持留档指向真实落点） */
  updateImagePath(id: number, newPath: string): void
  /** 解析库根路径（无库 → null，本批安全丢弃） */
  getLibraryRootPath(libraryId: number): string | null
  /** 触发该库增量扫描完成登记（复用 scanner 的 images 入库 + 缩略图） */
  scanLibrary(libraryId: number): Promise<unknown>
  /** 单文件迁移（默认同卷 rename，跨卷回退 copy+unlink）；测试注入替身 */
  relocate?(from: string, to: string): Promise<void>
}

export interface ImportResult {
  /** 成功迁移并登记的文件数 */
  moved: number
  /** 落点目录（相对库根，供 UI 反馈展示） */
  targetRelDir: string
  /** 目标目录内文件已迁移、扫描已触发 */
  scanned: boolean
  errors: string[]
}

/** 页面/来源名 → 安全目录名（去非法字符、限长、空回退） */
export function sanitizeDirName(raw: string | undefined | null, fallback: string): string {
  const cleaned = (raw ?? '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ')
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback
  return cleaned.slice(0, 80)
}

/** 从 sourceUrl 取主机名做站点目录（非法/无主机回退 'source'） */
function siteFromUrl(sourceUrl: string): string {
  try {
    return sanitizeDirName(new URL(sourceUrl).hostname, 'source')
  } catch {
    return 'source'
  }
}

async function defaultRelocate(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to)
  } catch (err) {
    // EXDEV：跨分区/跨盘 → 复制再删除
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.promises.copyFile(from, to)
      await fs.promises.unlink(from)
    } else {
      throw err
    }
  }
}

/**
 * accept 一个采集提案：把其页面媒体从 `_downloads` 迁入主库并触发扫描登记。
 * 单文件失败不阻断其余（尽力迁移 + 记录 errors），扫描只在至少迁移一个文件时触发。
 */
export async function importAcceptedCrawlerProposal(
  payload: CandidateItem,
  libraryId: number,
  deps: ProposalImportDeps,
): Promise<ImportResult> {
  const errors: string[] = []
  const root = deps.getLibraryRootPath(libraryId)
  if (!root) {
    return { moved: 0, targetRelDir: '', scanned: false, errors: ['无在线图库，无法落地'] }
  }
  if (typeof payload?.sourceId !== 'number' || typeof payload?.sourceUrl !== 'string') {
    return { moved: 0, targetRelDir: '', scanned: false, errors: ['提案 payload 缺 sourceId/sourceUrl'] }
  }

  const media = deps.listMedia(payload.sourceId, payload.sourceUrl)
  if (media.length === 0) {
    return { moved: 0, targetRelDir: '', scanned: false, errors: ['未找到该提案的已采媒体留档'] }
  }

  const site = siteFromUrl(payload.sourceUrl)
  const page = sanitizeDirName(payload.pageTitle, `p_${payload.sourceId}`)
  const relDir = path.join(IMPORT_DIR, `${site}`, page)
  const absDir = path.join(root, relDir)
  await fs.promises.mkdir(absDir, { recursive: true })

  const relocate = deps.relocate ?? defaultRelocate
  let moved = 0
  for (const item of media) {
    const from = item.imagePath as string
    try {
      if (!fs.existsSync(from)) {
        errors.push(`媒体文件缺失: ${from}`)
        continue
      }
      const to = path.join(absDir, path.basename(from))
      await relocate(from, to)
      // sidecar 随文件迁移（DB 损坏时的溯源副本），存在才搬
      const scFrom = sidecarPath(from)
      if (fs.existsSync(scFrom)) await relocate(scFrom, sidecarPath(to))
      deps.updateImagePath(item.id, to)
      moved++
    } catch (err) {
      errors.push(`${from}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  let scanned = false
  if (moved > 0) {
    try {
      await deps.scanLibrary(libraryId)
      scanned = true
    } catch (err) {
      errors.push(`扫描登记失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  logger.info(LOG_KEY, `提案 accept 落地：迁移 ${moved}/${media.length} 文件 → ${relDir}${scanned ? ' [已扫描登记]' : ''}`)
  return { moved, targetRelDir: relDir, scanned, errors }
}
