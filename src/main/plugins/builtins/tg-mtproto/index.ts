/**
 * T13c — builtin.tg-mtproto（Telegram MTProto 账号级连接器，pc-app 主通道）
 *
 * D10 例外：pc-app 形态在插件（Worker）内自跑协议栈，声明 `crawler.protocol` +
 * `crawler.write.media` 权限，不走宿主 request-executor。媒体经客户端直落
 * `{_downloads}/telegram/{chat}/`，产物以 `file://` 交 T15 intake 本地入库去重。
 *
 * 可测性与合规（决策：接口注入 + 动态 import，暂不安装）：
 *   - 本模块只依赖注入的 `TgClient` 接口，单测用替身覆盖游标推进/媒体落盘/缺客户端拒跑，**零网络**；
 *   - 真实 mtcute（@mtcute/node，MIT）客户端在 UtilityProcess 下的 crypto/长连接可用性属 **PoC R10 待验**，
 *     故此处不静态引入该依赖；生产由 `configureTgClientFactory` 在凭据+依赖就绪后注入工厂，
 *     未注入时 discover 明确抛错拒跑（宁拒勿含糊，避免半截假成功）。
 * 凭据（api_id/api_hash/手机号）经 settings + safeStorage，只写不读（沿 M2 Key 模式）；验证码走一次性 IPC challenge——均在宿主 T16 侧，本模块不触碰凭据。
 */
import { pathToFileURL } from 'url'
import type { CandidateDraft } from '../../../../types/agent'

export const TG_PLUGIN_ID = 'builtin.tg-mtproto'
export const TG_OP_DISCOVER = 'tg.discover'

// ── 注入面：MTProto 客户端最小契约（mtcute 适配或单测替身实现） ──

export interface TgMediaRef {
  kind: 'photo' | 'video' | 'document'
  fileId: string
}
export interface TgMessageLike {
  id: number
  date?: string
  text?: string
  senderName?: string
  media: TgMediaRef[]
}
export interface TgClient {
  /** 枚举 afterId 之后的新消息（游标=message_id） */
  iterMessages(chatId: string, afterId: number, limit: number): AsyncIterable<TgMessageLike>
  /** 把某条消息的媒体下载到 dir，回本地绝对路径（本期只回图片） */
  downloadMedia(msg: TgMessageLike, dir: string): Promise<{ path: string }[]>
}

export interface TgParams {
  chatId: string
  /** 单轮最多枚举消息数（限速保守） */
  limit?: number
  /** 媒体落盘根（宿主注入 {库根}/_downloads） */
  downloadDir?: string
}
export interface TgDiscoverInput {
  sourceConfig: { params: TgParams }
  watermark: string | null
}

/** 生产客户端工厂（Worker 启动时若 mtcute + 凭据就绪则注入；未注入 discover 拒跑） */
let clientFactory: (() => Promise<TgClient>) | null = null
export function configureTgClientFactory(factory: (() => Promise<TgClient>) | null): void {
  clientFactory = factory
}

function toDraft(msg: TgMessageLike, files: { path: string }[]): CandidateDraft | null {
  if (files.length === 0) return null
  const draft: CandidateDraft = {
    sourceUrl: `tg-mtproto://${msg.id}`,
    tags: [],
    mediaUrls: files.map(f => pathToFileURL(f.path).href),
  }
  if (typeof msg.text === 'string' && msg.text.trim()) draft.description = msg.text.trim()
  if (typeof msg.senderName === 'string' && msg.senderName.trim()) draft.author = msg.senderName.trim()
  if (typeof msg.date === 'string' && msg.date) draft.publishedAt = msg.date
  return draft
}

/**
 * pc-app discover：游标（message_id）之后增量枚举 → 下载图片 → file:// 草稿。
 * client 显式入参便于单测注入；生产 activate 从 clientFactory 取。
 */
export async function discover(
  input: TgDiscoverInput, client: TgClient | null, downloadDir: string,
): Promise<{ drafts: CandidateDraft[]; nextWatermark?: string }> {
  if (!client) {
    throw new Error('Telegram 客户端未就绪（mtcute 未安装或凭据缺失，PoC R10）——拒绝空跑')
  }
  const params = input.sourceConfig?.params
  const chatId = params?.chatId
  if (!chatId) throw new Error('tg-mtproto 缺 params.chatId')
  const limit = Math.max(1, Math.min(200, params.limit ?? 50))
  const afterId = input.watermark ? (Number.parseInt(input.watermark, 10) || 0) : 0

  const drafts: CandidateDraft[] = []
  let maxId = afterId
  for await (const msg of client.iterMessages(chatId, afterId, limit)) {
    if (msg.id <= afterId) continue
    maxId = Math.max(maxId, msg.id)
    if (msg.media.length === 0) continue
    const dir = `${downloadDir.replace(/[\\/]$/, '')}/telegram/${chatId}`
    const files = await client.downloadMedia(msg, dir)
    const d = toDraft(msg, files)
    if (d) drafts.push(d)
  }
  return { drafts, nextWatermark: maxId > afterId ? String(maxId) : undefined }
}

/** 插件激活：pc-app 只暴露 discover；客户端来自 configureTgClientFactory 注入 */
export function activate(): Record<string, (input: any) => Promise<unknown>> {
  return {
    [TG_OP_DISCOVER]: async (raw: unknown) => {
      const input = raw as TgDiscoverInput
      const client = clientFactory ? await clientFactory() : null
      return discover(input, client, input.sourceConfig?.params?.downloadDir ?? '')
    },
  }
}
