/**
 * T18 — ProposalImportService（accept 下游：把已采留档迁入主库）
 *
 * 时序：M3 发现阶段 intake 已把媒体下载到 `{库根}/_downloads/`（scanner 对下划线目录跳过，§8.3），
 * 仅写 crawl_items 留档，不碰主库 images 表。用户在 DiscoverPanel accept 提案后，本服务把该页面
 * 对应的 `_downloads` 媒体迁入库内可见目录（`Imported/`），再触发增量扫描登记（缩略图/元数据全复用 scanner）。
 *
 * skip/reject 不迁移（留 `_downloads` 由后续清理策略处理，人在回路绝不自动删用户内容）。
 *
 * 人在回路护栏：仅 `_downloads` 暂存区内的文件才搬移；pc-app 本地形态（如 tg-export-import）
 * 的 `image_path` 指向用户目录原件，accept 时只复制到 Imported/，原件原地保留，绝不搬走用户内容。
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

/** Windows 保留设备名（大小写不敏感，含带后缀形态如 CON.txt） */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 页面/来源名 → 安全目录名（去非法字符、去尾点/空格、保留名回退、限长、空回退） */
export function sanitizeDirName(raw: string | undefined | null, fallback: string): string {
  const cleaned = (raw ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '') // Win32 会剥离尾点/空格，主动去掉避免目录折叠/EINVAL
    .slice(0, 80)
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback
  if (RESERVED_NAME.test(cleaned.split('.')[0])) return fallback // 保留名（含 CON.xxx）
  return cleaned
}

/** 从 sourceUrl 取主机名做站点目录（非法/无主机回退 'source'） */
function siteFromUrl(sourceUrl: string): string {
  try {
    return sanitizeDirName(new URL(sourceUrl).hostname, 'source')
  } catch {
    return 'source'
  }
}

/** 只复制不删源（用于库外原件:人在回路护栏，绝不搬走用户目录里的原始文件） */
async function copyInto(from: string, to: string): Promise<void> {
  await fs.promises.copyFile(from, to)
}

/**
 * 同卷 rename → 跨卷/锁定回退为「复制 .tmp → 原子落位 → 尽力删源」。
 * 回退放宽至 EXDEV/EPERM/EBUSY/EACCES/ENOTEMPTY（Windows 跨卷或被占用常见）；
 * 删源失败不判失败（源滞留 _downloads 由后续清理策略处理，不阻断登记）。
 */
async function defaultRelocate(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EXDEV' || code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOTEMPTY') {
      const tmp = `${to}.tmp-${process.pid}-${Date.now()}`
      try {
        await fs.promises.copyFile(from, tmp)
        await fs.promises.rename(tmp, to) // 同目录 rename → 原子，避免半截文件被扫描登记
      } catch (inner) {
        await fs.promises.rm(tmp, { force: true }).catch(() => {})
        throw inner
      }
      await fs.promises.unlink(from).catch(() => {}) // 删源尽力而为
    } else {
      throw err
    }
  }
}

/** 目标同名则追加 _1/_2… 唯一后缀，避免 POSIX rename 静默覆盖丢数据 */
function uniqueTargetPath(dir: string, basename: string): string {
  const first = path.join(dir, basename)
  if (!fs.existsSync(first)) return first
  const ext = path.extname(basename)
  const stem = basename.slice(0, basename.length - ext.length)
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${stem}_${i}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return path.join(dir, `${stem}_${Date.now()}${ext}`)
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

  // 落点目录准备纳入 try（H1）：库根不可写/路径过长等异常统一回 errors，不再冒泡致 accept 静默崩溃
  let absDir: string
  let relDir: string
  try {
    const site = siteFromUrl(payload.sourceUrl)
    const page = sanitizeDirName(payload.pageTitle, `p_${payload.sourceId}`)
    relDir = path.join(IMPORT_DIR, site, page)
    absDir = path.join(root, relDir)
    await fs.promises.mkdir(absDir, { recursive: true })
  } catch (err) {
    return { moved: 0, targetRelDir: '', scanned: false, errors: [`落点目录创建失败: ${err instanceof Error ? err.message : String(err)}`] }
  }

  // C1 人在回路护栏：仅 _downloads 暂存区内的文件才允许搬移；库外原件一律只复制不删源
  const dlPrefix = path.resolve(root, '_downloads') + path.sep
  const relocate = deps.relocate ?? defaultRelocate
  let moved = 0
  for (const item of media) {
    const from = item.imagePath as string
    try {
      if (typeof from !== 'string' || !path.isAbsolute(from)) {
        errors.push(`非法媒体路径: ${from}`)
        continue
      }
      if (!fs.existsSync(from)) {
        errors.push(`媒体文件缺失: ${from}`)
        continue
      }
      const to = uniqueTargetPath(absDir, path.basename(from))
      const insideStaging = path.resolve(from).startsWith(dlPrefix)
      if (insideStaging) await relocate(from, to)
      else await copyInto(from, to) // 库外原件:复制到 Imported,原件原地保留
      // sidecar 独立 try（M3）：随迁失败不连累主文件的 updateImagePath
      const scFrom = sidecarPath(from)
      if (fs.existsSync(scFrom)) {
        try {
          const scTo = sidecarPath(to)
          if (insideStaging) await relocate(scFrom, scTo)
          else await copyInto(scFrom, scTo)
        } catch (e) {
          errors.push(`sidecar 迁移失败: ${scFrom}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
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
