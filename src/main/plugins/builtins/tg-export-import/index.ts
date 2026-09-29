/**
 * T13c — builtin.tg-export-import（Telegram tdesktop 官方导出导入，pc-app 保底零网络通道）
 *
 * 定位：Telegram「PC 端接入」的**保底通道**——用户用 tdesktop 自带「导出聊天记录」得到
 * `result.json` + `media/` 子树，本适配器纯本地解析，**零网络零凭据**（D10 下 pc-app 例外，
 * 但此通道连协议栈都不碰）。产物经 T15 intake 的 `file://` 本地路径直接入库去重（决策：本地入库接缝）。
 *
 * 游标：config.watermark = 已处理的最后一条 message id（数字串），重导入自动续跑。
 * 口径：仅收图片（jpg/png/webp/gif/avif…），视频/文档不入本期（与 T14 一致）。
 * 纯本地文件读取，无网络；单测注入临时导出目录 fixture。
 */
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import type { CandidateDraft, CrawlSourceRecord } from '../../../../types/agent'

export const TGE_PLUGIN_ID = 'builtin.tg-export-import'
export const TGE_OP_DISCOVER = 'tge.discover'

export interface TgExportParams {
  /** tdesktop 导出根目录（含 result.json 与 media/） */
  exportDir: string
  /** 多会话导出时按名选取；缺省取第一个含媒体的会话 */
  chatName?: string
}

/** discover op 入参（宿主 runPcApp 传入，形状对齐 BuildRequestsInput 的 pc-app 变体） */
export interface DiscoverInput {
  sourceConfig: CrawlSourceRecord['config'] & { params: TgExportParams }
  watermark: string | null
}

const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'])
const isImageName = (name: unknown): name is string =>
  typeof name === 'string' && IMG_EXT.has(path.extname(name).replace('.', '').toLowerCase())

interface TdMessage {
  id?: number
  date?: number
  date_iso?: string
  type?: string
  text?: string
  from?: string
  photo?: string
  file?: string
}
interface TdChat { name?: string; messages?: TdMessage[] }

function fileUrl(absPath: string): string {
  return pathToFileURL(absPath).href
}

/** 从 result.json 里挑一个含图片消息的会话 */
function pickChat(chats: TdChat[], wantName?: string): TdChat | null {
  const withMedia = chats.filter(c => Array.isArray(c.messages) && c.messages.some(m => isImageName(m.photo) || isImageName(m.file)))
  if (wantName) return withMedia.find(c => c.name === wantName) ?? withMedia[0] ?? null
  return withMedia[0] ?? null
}

function toDraft(chat: TdChat, msg: TdMessage, mediaDir: string) {
  const name = isImageName(msg.photo) ? msg.photo : isImageName(msg.file) ? msg.file : null
  if (!name) return null
  const abs = path.join(mediaDir, name)
  if (!fs.existsSync(abs)) return null
  const id = msg.id ?? 0
  const draft: CandidateDraft = {
    sourceUrl: `tg-export://${chat.name ?? 'chat'}/${id}`,
    tags: [],
    mediaUrls: [fileUrl(abs)],
  }
  if (typeof msg.text === 'string' && msg.text.trim()) draft.description = msg.text.trim()
  if (typeof msg.from === 'string' && msg.from.trim()) draft.author = msg.from.trim()
  const iso = msg.date_iso ?? (msg.date != null ? new Date(msg.date * 1000).toISOString() : undefined)
  if (iso) draft.publishedAt = iso
  return draft
}

/** op：枚举导出目录游标之后的新图片消息 → 本地 file:// 草稿（零网络） */
export function discover(input: DiscoverInput): { drafts: unknown[]; nextWatermark?: string } {
  const params = input.sourceConfig.params
  const exportDir = params?.exportDir
  if (!exportDir) throw new Error('tg-export-import 缺 params.exportDir（tdesktop 导出目录）')
  const resultJson = path.join(exportDir, 'result.json')
  if (!fs.existsSync(resultJson)) throw new Error(`导出目录缺 result.json：${resultJson}`)

  let data: { chats?: TdChat[] } & TdChat
  try {
    data = JSON.parse(fs.readFileSync(resultJson, 'utf-8'))
  } catch (err) {
    throw new Error(`result.json 解析失败：${err instanceof Error ? err.message : String(err)}`)
  }
  const chats: TdChat[] = Array.isArray(data.chats) ? data.chats : [data]
  const chat = pickChat(chats, params.chatName)
  if (!chat) return { drafts: [] }

  const mediaDir = path.join(exportDir, 'media')
  const afterId = input.watermark ? (Number.parseInt(input.watermark, 10) || 0) : 0
  const drafts: unknown[] = []
  let maxId = afterId
  for (const msg of chat.messages ?? []) {
    const id = msg.id ?? 0
    if (id <= afterId) continue
    const d = toDraft(chat, msg, mediaDir)
    if (d) drafts.push(d)
    if (id > maxId) maxId = id
  }
  // 游标推进到最后一条消息 id（即便该条无图，也代表「已消费到此」）
  return { drafts, nextWatermark: maxId > afterId ? String(maxId) : undefined }
}

/** 插件激活：pc-app 只暴露 discover（媒体走 file://，由宿主 intake 本地入库） */
export function activate(): Record<string, (input: any) => unknown> {
  return {
    [TGE_OP_DISCOVER]: raw => discover(raw as DiscoverInput),
  }
}
